// src/storage/index.ts
import fs from 'fs';
import path from 'path';
import { Capture, Route, Config, ExecutionStep } from '../types.js';

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
    ];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  // Captures
  async saveCapture(capture: Capture): Promise<void> {
    const filePath = path.join(this.dataDir, 'captures', `${capture.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(capture, null, 2));
  }

  async getCapture(id: string): Promise<Capture | null> {
    const filePath = path.join(this.dataDir, 'captures', `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Capture;
  }

  async listCaptures(limit: number = 50): Promise<Capture[]> {
    const capturesDir = path.join(this.dataDir, 'captures');
    if (!fs.existsSync(capturesDir)) {
      return [];
    }
    const files = fs.readdirSync(capturesDir)
      .filter(f => f.endsWith('.json'))
      .slice(0, limit);

    const captures: Capture[] = [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(capturesDir, file), 'utf-8');
      captures.push(JSON.parse(content) as Capture);
    }
    return captures.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
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
}
