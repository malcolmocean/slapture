// src/routes/executor.ts
import { Route, Capture } from '../types.js';
import { Storage } from '../storage/index.js';
import { IntendExecutor } from './intend-executor.js';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

export interface ExecutionResult {
  success: boolean;
  error?: string;
  status?: 'success' | 'failed' | 'blocked_needs_auth' | 'blocked_auth_expired';
}

export class RouteExecutor {
  private filestoreRoot: string;
  private storage: Storage | null;
  private intendExecutor: IntendExecutor | null;

  constructor(filestoreRoot: string = './filestore', storage?: Storage) {
    this.filestoreRoot = filestoreRoot;
    this.storage = storage || null;
    this.intendExecutor = storage ? new IntendExecutor(storage) : null;
  }

  async execute(
    route: Route,
    payload: string,
    username: string,
    metadata: Record<string, string>,
    timestamp?: string,
    capture?: Capture
  ): Promise<ExecutionResult> {
    // Handle intend destination type
    if (route.destinationType === 'intend') {
      if (!this.intendExecutor || !capture) {
        return {
          success: false,
          status: 'failed',
          error: 'IntendExecutor not configured or capture not provided',
        };
      }
      const intendResult = await this.intendExecutor.execute(route, capture);
      return {
        success: intendResult.status === 'success',
        status: intendResult.status,
        error: intendResult.error,
      };
    }

    // Only handle 'fs' destination type below
    if (route.destinationType !== 'fs') {
      return {
        success: false,
        status: 'failed',
        error: `Unsupported destination type: ${route.destinationType}`,
      };
    }

    const userDir = path.join(this.filestoreRoot, username);

    // Ensure user directory exists
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    // Resolve and validate file path (type narrowed by destinationType check above)
    const configuredPath = (route.destinationConfig as { filePath: string }).filePath;
    const absolutePath = path.resolve(userDir, configuredPath);
    const normalizedUserDir = path.resolve(userDir);

    // Path traversal check
    if (!absolutePath.startsWith(normalizedUserDir)) {
      throw new Error(`Path validation failed: ${configuredPath} escapes user directory`);
    }

    // Ensure parent directory exists
    const parentDir = path.dirname(absolutePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // If no transform script, just write payload
    if (!route.transformScript) {
      fs.writeFileSync(absolutePath, payload);
      return { success: true };
    }

    // Create sandboxed fs that only allows operations within user directory
    const sandboxedFs = this.createSandboxedFs(normalizedUserDir);

    // Execute transform script in vm
    const context = vm.createContext({
      fs: sandboxedFs,
      payload,
      filePath: absolutePath,
      timestamp: timestamp || new Date().toISOString(),
      metadata,
      console: { log: () => {}, error: () => {} }, // Suppress console
      JSON,
    });

    try {
      vm.runInContext(route.transformScript, context, {
        timeout: 5000, // 5 second timeout
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private createSandboxedFs(userDir: string) {
    const validatePath = (p: string) => {
      // Resolve relative paths within the user directory
      const resolved = path.isAbsolute(p) ? p : path.resolve(userDir, p);
      if (!resolved.startsWith(userDir)) {
        throw new Error(`Path validation failed: access denied outside user directory`);
      }
      return resolved;
    };

    return {
      readFileSync: (p: string, encoding?: string) => {
        return fs.readFileSync(validatePath(p), encoding as BufferEncoding);
      },
      writeFileSync: (p: string, data: string) => {
        const validated = validatePath(p);
        const parentDir = path.dirname(validated);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.writeFileSync(validated, data);
      },
      appendFileSync: (p: string, data: string) => {
        const validated = validatePath(p);
        const parentDir = path.dirname(validated);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.appendFileSync(validated, data);
      },
      existsSync: (p: string) => {
        try {
          return fs.existsSync(validatePath(p));
        } catch {
          return false;
        }
      },
      mkdirSync: (p: string, options?: fs.MakeDirectoryOptions) => {
        fs.mkdirSync(validatePath(p), options);
      },
      readdirSync: (p: string) => {
        return fs.readdirSync(validatePath(p));
      },
      unlinkSync: (p: string) => {
        fs.unlinkSync(validatePath(p));
      },
    };
  }
}
