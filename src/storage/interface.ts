// src/storage/interface.ts
import type { Capture, Route, Config, ExecutionStep, EvolverTestCase, IntendTokens, SheetsTokens, TriggerChangeReview, UserProfile, ApiKey } from '../types.js';
import type { HygieneSignal } from '../hygiene/index.js';

export interface StorageInterface {
  // Captures
  saveCapture(capture: Capture, username?: string): Promise<void>;
  getCapture(id: string, username?: string): Promise<Capture | null>;
  updateCapture(capture: Capture): Promise<void>;
  listCaptures(limit?: number, username?: string): Promise<Capture[]>;
  listAllCaptures(username?: string): Promise<Capture[]>;
  listCapturesNeedingAuth(username?: string): Promise<Capture[]>;

  // Routes
  saveRoute(route: Route): Promise<void>;
  getRoute(id: string): Promise<Route | null>;
  listRoutes(): Promise<Route[]>;
  getRouteByName(name: string): Promise<Route | null>;

  // Execution traces
  saveExecutionTrace(captureId: string, trace: ExecutionStep[]): Promise<void>;

  // Config
  getConfig(): Promise<Config>;
  saveConfig(config: Config): Promise<void>;

  // Inbox
  appendToInbox(entry: string): Promise<void>;

  // Evolver test cases
  saveEvolverTestCase(testCase: EvolverTestCase): Promise<void>;
  getEvolverTestCase(id: string): Promise<EvolverTestCase | null>;
  listEvolverTestCases(): Promise<EvolverTestCase[]>;
  deleteEvolverTestCase(id: string): Promise<void>;
  pruneEvolverTestCases(keepRecent?: number): Promise<void>;

  // Per-user tokens
  saveIntendTokens(username: string, tokens: IntendTokens): Promise<void>;
  getIntendTokens(username: string): Promise<IntendTokens | null>;
  clearIntendTokens(username: string): Promise<void>;

  saveSheetsTokens(username: string, tokens: SheetsTokens): Promise<void>;
  getSheetsTokens(username: string): Promise<SheetsTokens | null>;
  clearSheetsTokens(username: string): Promise<void>;

  // Integration notes
  getIntegrationNote(username: string, integrationId: string): Promise<string | null>;
  saveIntegrationNote(username: string, integrationId: string, content: string): Promise<void>;

  // Destination notes
  getDestinationNote(username: string, destinationId: string): Promise<string | null>;
  saveDestinationNote(username: string, destinationId: string, content: string): Promise<void>;

  // Hygiene signals
  appendHygieneSignal(signal: HygieneSignal): Promise<void>;
  getHygieneSignals(): Promise<HygieneSignal[]>;
  getHygieneSignalsForRoute(routeId: string): Promise<HygieneSignal[]>;

  // Trigger change reviews
  saveTriggerReview(review: TriggerChangeReview): Promise<void>;
  getTriggerReview(id: string): Promise<TriggerChangeReview | null>;
  listTriggerReviews(status?: TriggerChangeReview['status']): Promise<TriggerChangeReview[]>;
  updateTriggerReviewStatus(id: string, status: 'approved' | 'rejected'): Promise<boolean>;
  deleteTriggerReview(id: string): Promise<void>;

  // User management
  saveUser(profile: UserProfile): Promise<void>;
  getUser(uid: string): Promise<UserProfile | null>;

  // API key management
  saveApiKey(uid: string, key: ApiKey): Promise<void>;
  listApiKeys(uid: string): Promise<ApiKey[]>;
  getApiKey(uid: string, keyId: string): Promise<ApiKey | null>;
  updateApiKey(uid: string, key: ApiKey): Promise<void>;
  deleteApiKey(uid: string, keyId: string): Promise<void>;

  // API key index (for fast lookup by hash)
  saveApiKeyIndex(keyHash: string, uid: string, keyId: string): Promise<void>;
  getApiKeyIndex(keyHash: string): Promise<{ uid: string; keyId: string } | null>;
  deleteApiKeyIndex(keyHash: string): Promise<void>;
}
