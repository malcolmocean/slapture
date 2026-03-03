// src/storage/index.ts
import fs from 'fs';
import path from 'path';
import { Capture, Route, Config, ExecutionStep, EvolverTestCase, IntendTokens, TriggerChangeReview, UserProfile, ApiKey } from '../types.js';
import type { HygieneSignal } from '../hygiene/index.js';
import type { StorageInterface } from './interface.js';

export class Storage implements StorageInterface {
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
      path.join(this.dataDir, 'trigger-reviews'),
    ];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  private ensureUserCapturesDir(username: string): string {
    this.validateUsername(username);
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

  async getCapture(id: string, _username?: string): Promise<Capture | null> {
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

  async updateCapture(capture: Capture): Promise<void> {
    // Find the file and update it
    const capturesDir = path.join(this.dataDir, 'captures');

    // Check legacy format
    const legacyPath = path.join(capturesDir, `${capture.id}.json`);
    if (fs.existsSync(legacyPath)) {
      fs.writeFileSync(legacyPath, JSON.stringify(capture, null, 2));
      return;
    }

    // Search in user subdirectories
    const entries = fs.readdirSync(capturesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const userDir = path.join(capturesDir, entry.name);
        const files = fs.readdirSync(userDir).filter(f => f.endsWith(`_${capture.id}.json`));
        if (files.length > 0) {
          fs.writeFileSync(path.join(userDir, files[0]), JSON.stringify(capture, null, 2));
          return;
        }
      }
    }

    // If not found, save as new (use username from capture)
    await this.saveCapture(capture, capture.username || 'default');
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

  // Per-user config management
  private validateUsername(username: string): void {
    if (!username || typeof username !== 'string' || username.includes('/') || username.includes('\\') || username === '..' || username === '.') {
      throw new Error('Invalid username');
    }
  }

  private ensureUserDir(username: string): string {
    this.validateUsername(username);
    const userDir = path.join(this.dataDir, 'users', username);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    return userDir;
  }

  private getUserConfigPath(username: string): string {
    return path.join(this.ensureUserDir(username), 'config.json');
  }

  private async getUserConfig(username: string): Promise<{ integrations?: { intend?: IntendTokens } }> {
    const configPath = this.getUserConfigPath(username);
    if (!fs.existsSync(configPath)) {
      return {};
    }
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content);
  }

  private async saveUserConfig(username: string, config: { integrations?: { intend?: IntendTokens } }): Promise<void> {
    const configPath = this.getUserConfigPath(username);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  // Integration Token Storage (intend.do OAuth) - now per-user
  async saveIntendTokens(username: string, tokens: IntendTokens): Promise<void> {
    const config = await this.getUserConfig(username);
    config.integrations = config.integrations || {};
    config.integrations.intend = tokens;
    await this.saveUserConfig(username, config);
  }

  async getIntendTokens(username: string): Promise<IntendTokens | null> {
    const config = await this.getUserConfig(username);
    return config.integrations?.intend || null;
  }

  async clearIntendTokens(username: string): Promise<void> {
    const config = await this.getUserConfig(username);
    if (config.integrations) {
      delete config.integrations.intend;
      await this.saveUserConfig(username, config);
    }
  }

  // List captures blocked on authentication
  async listCapturesNeedingAuth(username?: string): Promise<Capture[]> {
    const captures = await this.listAllCaptures(username);
    return captures.filter(c =>
      c.executionResult === 'blocked_needs_auth' ||
      c.executionResult === 'blocked_auth_expired'
    );
  }

  // Sanitize an ID to be filesystem-safe
  private sanitizeId(id: string): string {
    // Replace characters that are unsafe for filenames: / \ : * ? " < > |
    return id.replace(/[/\\:*?"<>|]/g, '_');
  }

  // Integration Notes
  private getIntegrationNotePath(username: string, integrationId: string): string {
    const notesDir = path.join(this.ensureUserDir(username), 'notes', 'integrations');
    if (!fs.existsSync(notesDir)) {
      fs.mkdirSync(notesDir, { recursive: true });
    }
    return path.join(notesDir, `${integrationId}.txt`);
  }

  async getIntegrationNote(username: string, integrationId: string): Promise<string | null> {
    this.validateUsername(username);
    const notePath = this.getIntegrationNotePath(username, integrationId);
    if (!fs.existsSync(notePath)) {
      return null;
    }
    return fs.readFileSync(notePath, 'utf-8');
  }

  async saveIntegrationNote(username: string, integrationId: string, content: string): Promise<void> {
    this.validateUsername(username);
    const notePath = this.getIntegrationNotePath(username, integrationId);
    fs.writeFileSync(notePath, content);
  }

  // Destination Notes
  private getDestinationNotePath(username: string, destinationId: string): string {
    const notesDir = path.join(this.ensureUserDir(username), 'notes', 'destinations');
    if (!fs.existsSync(notesDir)) {
      fs.mkdirSync(notesDir, { recursive: true });
    }
    const safeId = this.sanitizeId(destinationId);
    return path.join(notesDir, `${safeId}.txt`);
  }

  async getDestinationNote(username: string, destinationId: string): Promise<string | null> {
    this.validateUsername(username);
    const notePath = this.getDestinationNotePath(username, destinationId);
    if (!fs.existsSync(notePath)) {
      return null;
    }
    return fs.readFileSync(notePath, 'utf-8');
  }

  async saveDestinationNote(username: string, destinationId: string, content: string): Promise<void> {
    this.validateUsername(username);
    const notePath = this.getDestinationNotePath(username, destinationId);
    fs.writeFileSync(notePath, content);
  }

  // Migration: move global tokens to per-user format
  async migrateGlobalTokensIfNeeded(): Promise<void> {
    const globalConfigPath = path.join(this.dataDir, 'config.json');
    if (!fs.existsSync(globalConfigPath)) {
      return;
    }

    const globalConfig = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
    const globalTokens = globalConfig.integrations?.intend;

    if (!globalTokens) {
      return; // Nothing to migrate
    }

    // Check if default user already has tokens (don't overwrite)
    const existingUserTokens = await this.getIntendTokens('default');
    if (existingUserTokens) {
      // Just clean up global config
      delete globalConfig.integrations.intend;
      if (Object.keys(globalConfig.integrations).length === 0) {
        delete globalConfig.integrations;
      }
      fs.writeFileSync(globalConfigPath, JSON.stringify(globalConfig, null, 2));
      console.log('[Migration] Removed stale global tokens (user tokens exist)');
      return;
    }

    // Migrate to default user
    await this.saveIntendTokens('default', globalTokens);

    // Clean up global config
    delete globalConfig.integrations.intend;
    if (Object.keys(globalConfig.integrations).length === 0) {
      delete globalConfig.integrations;
    }
    fs.writeFileSync(globalConfigPath, JSON.stringify(globalConfig, null, 2));

    console.log('[Migration] Migrated global tokens to user: default');
  }

  // Hygiene Signals
  private getHygieneSignalsPath(): string {
    return path.join(this.dataDir, 'hygiene-signals.json');
  }

  async appendHygieneSignal(signal: HygieneSignal): Promise<void> {
    const signals = await this.getHygieneSignals();
    signals.push(signal);
    fs.writeFileSync(this.getHygieneSignalsPath(), JSON.stringify(signals, null, 2));
  }

  async getHygieneSignals(): Promise<HygieneSignal[]> {
    const filePath = this.getHygieneSignalsPath();
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as HygieneSignal[];
  }

  async getHygieneSignalsForRoute(routeId: string): Promise<HygieneSignal[]> {
    const signals = await this.getHygieneSignals();
    return signals.filter(s => s.routeId === routeId);
  }

  // Trigger Change Reviews
  private getTriggerReviewPath(id: string): string {
    return path.join(this.dataDir, 'trigger-reviews', `${id}.json`);
  }

  async saveTriggerReview(review: TriggerChangeReview): Promise<void> {
    const filePath = this.getTriggerReviewPath(review.id);
    fs.writeFileSync(filePath, JSON.stringify(review, null, 2));
  }

  async getTriggerReview(id: string): Promise<TriggerChangeReview | null> {
    const filePath = this.getTriggerReviewPath(id);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as TriggerChangeReview;
  }

  async listTriggerReviews(status?: TriggerChangeReview['status']): Promise<TriggerChangeReview[]> {
    const reviewsDir = path.join(this.dataDir, 'trigger-reviews');
    if (!fs.existsSync(reviewsDir)) {
      return [];
    }
    const files = fs.readdirSync(reviewsDir).filter(f => f.endsWith('.json'));
    const reviews: TriggerChangeReview[] = [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(reviewsDir, file), 'utf-8');
      const review = JSON.parse(content) as TriggerChangeReview;
      if (!status || review.status === status) {
        reviews.push(review);
      }
    }
    return reviews;
  }

  async updateTriggerReviewStatus(id: string, status: 'approved' | 'rejected'): Promise<boolean> {
    const review = await this.getTriggerReview(id);
    if (!review) {
      return false;
    }
    review.status = status;
    await this.saveTriggerReview(review);
    return true;
  }

  async deleteTriggerReview(id: string): Promise<void> {
    const filePath = this.getTriggerReviewPath(id);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  // User management (local JSON file storage)
  private ensureUsersDir(): string {
    const dir = path.join(this.dataDir, 'users');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private getUserProfilePath(uid: string): string {
    return path.join(this.ensureUsersDir(), `${uid}.json`);
  }

  async saveUser(profile: UserProfile): Promise<void> {
    fs.writeFileSync(this.getUserProfilePath(profile.uid), JSON.stringify(profile, null, 2));
  }

  async getUser(uid: string): Promise<UserProfile | null> {
    const filePath = this.getUserProfilePath(uid);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  // API key management (local JSON file storage)
  private ensureApiKeysDir(uid: string): string {
    const dir = path.join(this.dataDir, 'api-keys', uid);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  async saveApiKey(uid: string, key: ApiKey): Promise<void> {
    const filePath = path.join(this.ensureApiKeysDir(uid), `${key.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(key, null, 2));
  }

  async listApiKeys(uid: string): Promise<ApiKey[]> {
    const dir = path.join(this.dataDir, 'api-keys', uid);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
  }

  async getApiKey(uid: string, keyId: string): Promise<ApiKey | null> {
    const filePath = path.join(this.dataDir, 'api-keys', uid, `${keyId}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  async updateApiKey(uid: string, key: ApiKey): Promise<void> {
    await this.saveApiKey(uid, key);
  }

  async deleteApiKey(uid: string, keyId: string): Promise<void> {
    const filePath = path.join(this.dataDir, 'api-keys', uid, `${keyId}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  // API key index (local JSON file storage)
  private ensureApiKeyIndexDir(): string {
    const dir = path.join(this.dataDir, 'api-key-index');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  async saveApiKeyIndex(keyHash: string, uid: string, keyId: string): Promise<void> {
    const filePath = path.join(this.ensureApiKeyIndexDir(), `${keyHash}.json`);
    fs.writeFileSync(filePath, JSON.stringify({ uid, keyId }, null, 2));
  }

  async getApiKeyIndex(keyHash: string): Promise<{ uid: string; keyId: string } | null> {
    const filePath = path.join(this.dataDir, 'api-key-index', `${keyHash}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  async deleteApiKeyIndex(keyHash: string): Promise<void> {
    const filePath = path.join(this.dataDir, 'api-key-index', `${keyHash}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

export type { StorageInterface } from './interface.js';
