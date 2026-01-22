// src/storage/index.ts
import fs from 'fs';
import path from 'path';
import { Capture, Route, Config, ExecutionStep, EvolverTestCase, IntendTokens } from '../types.js';

export class Storage {
  private dataDir: string;

  constructor(dataDir: string = './data') {
    this.dataDir = dataDir;
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    const dirs = [
      this.dataDir,
      path.join(this.dataDir, 'captures'),
      path.join(this.dataDir, 'routes'),
      path.join(this.dataDir, 'executions'),
      path.join(this.dataDir, 'evolver-tests'),
    ];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  private ensureUserCapturesDir(username: string): string {
    const userDir = path.join(this.dataDir, 'captures', username);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    return userDir;
  }

  private formatCaptureFilename(capture: Capture, username: string): string {
    // Format: 2026-01-22T14-56-54-098Z_uuid.json (full ISO with filename-safe punctuation)
    const safeTimestamp = capture.timestamp.replace(/:/g, '-').replace(/\./g, '-');
    return `${safeTimestamp}_${capture.id}.json`;
  }

  // Captures
  // New format: captures/:username/:isodate_:uuid.json
  async saveCapture(capture: Capture, username: string = 'default'): Promise<void> {
    const userDir = this.ensureUserCapturesDir(username);
    const filename = this.formatCaptureFilename(capture, username);
    const filePath = path.join(userDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(capture, null, 2));
  }

  async getCapture(id: string): Promise<Capture | null> {
    // Try legacy flat format first
    const legacyPath = path.join(this.dataDir, 'captures', `${id}.json`);
    if (fs.existsSync(legacyPath)) {
      const content = fs.readFileSync(legacyPath, 'utf-8');
      return JSON.parse(content) as Capture;
    }

    // Search in user subdirectories for new format
    const capturesDir = path.join(this.dataDir, 'captures');
    const entries = fs.readdirSync(capturesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const userDir = path.join(capturesDir, entry.name);
        const files = fs.readdirSync(userDir).filter(f => f.endsWith(`_${id}.json`));
        if (files.length > 0) {
          const content = fs.readFileSync(path.join(userDir, files[0]), 'utf-8');
          return JSON.parse(content) as Capture;
        }
      }
    }

    return null;
  }

  async listCaptures(limit: number = 50, username?: string): Promise<Capture[]> {
    const captures = await this.listAllCaptures(username);
    return captures
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  async listAllCaptures(username?: string): Promise<Capture[]> {
    const capturesDir = path.join(this.dataDir, 'captures');
    if (!fs.existsSync(capturesDir)) {
      return [];
    }

    const captures: Capture[] = [];
    const entries = fs.readdirSync(capturesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // New format: subdirectory per user
        if (username && entry.name !== username) continue;
        const userDir = path.join(capturesDir, entry.name);
        const files = fs.readdirSync(userDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          const content = fs.readFileSync(path.join(userDir, file), 'utf-8');
          captures.push(JSON.parse(content) as Capture);
        }
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        // Legacy format: flat files in captures/
        const content = fs.readFileSync(path.join(capturesDir, entry.name), 'utf-8');
        captures.push(JSON.parse(content) as Capture);
      }
    }

    return captures;
  }

  // Routes
  async saveRoute(route: Route): Promise<void> {
    const filePath = path.join(this.dataDir, 'routes', `${route.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(route, null, 2));
  }

  async getRoute(id: string): Promise<Route | null> {
    const filePath = path.join(this.dataDir, 'routes', `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Route;
  }

  async listRoutes(): Promise<Route[]> {
    const routesDir = path.join(this.dataDir, 'routes');
    if (!fs.existsSync(routesDir)) {
      return [];
    }
    const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.json'));
    const routes: Route[] = [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(routesDir, file), 'utf-8');
      routes.push(JSON.parse(content) as Route);
    }
    return routes;
  }

  async getRouteByName(name: string): Promise<Route | null> {
    const routes = await this.listRoutes();
    return routes.find(r => r.name === name) || null;
  }

  // Execution traces
  async saveExecutionTrace(captureId: string, trace: ExecutionStep[]): Promise<void> {
    const filePath = path.join(this.dataDir, 'executions', `${captureId}-trace.json`);
    fs.writeFileSync(filePath, JSON.stringify(trace, null, 2));
  }

  // Config
  async getConfig(): Promise<Config> {
    const filePath = path.join(this.dataDir, 'config.json');
    if (!fs.existsSync(filePath)) {
      const defaultConfig: Config = {
        authToken: 'dev-token',
        requireApproval: false,
        approvalGuardPrompt: null,
        mastermindRetryAttempts: 3,
      };
      fs.writeFileSync(filePath, JSON.stringify(defaultConfig, null, 2));
      return defaultConfig;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Config;
  }

  async saveConfig(config: Config): Promise<void> {
    const filePath = path.join(this.dataDir, 'config.json');
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
  }

  // Inbox (fallback for failures)
  async appendToInbox(entry: string): Promise<void> {
    const filePath = path.join(this.dataDir, 'slapture-inbox.txt');
    fs.appendFileSync(filePath, `${new Date().toISOString()}: ${entry}\n`);
  }

  // Evolver Test Cases
  async saveEvolverTestCase(testCase: EvolverTestCase): Promise<void> {
    const filePath = path.join(this.dataDir, 'evolver-tests', `${testCase.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(testCase, null, 2));
  }

  async getEvolverTestCase(id: string): Promise<EvolverTestCase | null> {
    const filePath = path.join(this.dataDir, 'evolver-tests', `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as EvolverTestCase;
  }

  async listEvolverTestCases(): Promise<EvolverTestCase[]> {
    const testsDir = path.join(this.dataDir, 'evolver-tests');
    if (!fs.existsSync(testsDir)) {
      return [];
    }
    const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.json'));
    const testCases: EvolverTestCase[] = [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(testsDir, file), 'utf-8');
      testCases.push(JSON.parse(content) as EvolverTestCase);
    }
    return testCases;
  }

  async deleteEvolverTestCase(id: string): Promise<void> {
    const filePath = path.join(this.dataDir, 'evolver-tests', `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  /**
   * Prune old non-ratchet test cases, keeping only the most recent N.
   * Ratchet cases (where evolution happened) are never auto-deleted.
   */
  async pruneEvolverTestCases(keepRecent: number = 5): Promise<void> {
    const allCases = await this.listEvolverTestCases();

    // Separate ratchet cases (keep forever) from non-ratchet (rolling window)
    const ratchetCases = allCases.filter(tc => tc.isRatchetCase);
    const nonRatchetCases = allCases.filter(tc => !tc.isRatchetCase);

    // Sort non-ratchet by timestamp, newest first
    nonRatchetCases.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Delete old non-ratchet cases beyond the limit
    const toDelete = nonRatchetCases.slice(keepRecent);
    for (const tc of toDelete) {
      await this.deleteEvolverTestCase(tc.id);
    }
  }

  // Integration Token Storage (intend.do OAuth)
  async saveIntendTokens(tokens: IntendTokens): Promise<void> {
    const config = await this.getConfig();
    config.integrations = config.integrations || {};
    config.integrations.intend = tokens;
    await this.saveConfig(config);
  }

  async getIntendTokens(): Promise<IntendTokens | null> {
    const config = await this.getConfig();
    return config.integrations?.intend || null;
  }

  async clearIntendTokens(): Promise<void> {
    const config = await this.getConfig();
    if (config.integrations) {
      delete config.integrations.intend;
      await this.saveConfig(config);
    }
  }

  // List captures blocked on authentication
  async listCapturesNeedingAuth(): Promise<Capture[]> {
    const captures = await this.listAllCaptures();
    return captures.filter(c =>
      c.executionResult === 'blocked_needs_auth' ||
      c.executionResult === 'blocked_auth_expired'
    );
  }
}
