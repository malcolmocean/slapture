// src/routes/executor.ts
import { Route, Capture } from '../types.js';
import type { StorageInterface } from '../storage/interface.js';
import { IntendExecutor } from './intend-executor.js';
import { NotesExecutor } from './notes-executor.js';
import { SheetsExecutor } from './sheets-executor.js';
import { RoamExecutor } from './roam-executor.js';
import { FileSheetsAuthProvider } from '../integrations/sheets/auth.js';
import type { SheetsAuthProvider } from '../integrations/sheets/types.js';
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
  private storage: StorageInterface | null;
  private intendExecutor: IntendExecutor | null;
  private notesExecutor: NotesExecutor | null;
  private sheetsExecutor: SheetsExecutor | null;
  private roamExecutor: RoamExecutor | null;

  constructor(filestoreRoot: string = './filestore', storage?: StorageInterface, sheetsAuthProvider?: SheetsAuthProvider) {
    this.filestoreRoot = filestoreRoot;
    this.storage = storage || null;
    this.intendExecutor = storage ? new IntendExecutor(storage) : null;
    this.notesExecutor = storage ? new NotesExecutor(storage) : null;
    const authProvider = sheetsAuthProvider ?? new FileSheetsAuthProvider();
    this.sheetsExecutor = new SheetsExecutor(authProvider);
    this.roamExecutor = storage ? new RoamExecutor(storage) : null;
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

    // Handle notes destination type
    if (route.destinationType === 'notes') {
      if (!this.notesExecutor || !capture) {
        return {
          success: false,
          status: 'failed',
          error: 'NotesExecutor not configured or capture not provided',
        };
      }
      const notesResult = await this.notesExecutor.execute(route, capture);
      return {
        success: notesResult.status === 'success',
        status: notesResult.status,
        error: notesResult.error,
      };
    }

    // Handle sheets destination type
    if (route.destinationType === 'sheets') {
      if (!this.sheetsExecutor || !capture) {
        return {
          success: false,
          status: 'failed',
          error: 'SheetsExecutor not configured or capture not provided',
        };
      }
      const sheetsResult = await this.sheetsExecutor.execute(route, capture);
      return {
        success: sheetsResult.status === 'success',
        status: sheetsResult.status,
        error: sheetsResult.error,
      };
    }

    // Handle roam destination type
    if (route.destinationType === 'roam') {
      if (!this.roamExecutor || !capture) {
        return {
          success: false,
          status: 'failed',
          error: 'RoamExecutor not configured or capture not provided',
        };
      }
      const roamResult = await this.roamExecutor.execute(route, capture);
      return {
        success: roamResult.status === 'success',
        status: roamResult.status,
        error: roamResult.error,
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
