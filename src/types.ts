export interface Capture {
  id: string;
  raw: string;
  timestamp: string;

  parsed: {
    explicitRoute: string | null;
    payload: string;
    metadata: Record<string, string>;
  } | null;

  routeProposed: string | null;
  routeConfidence: 'high' | 'medium' | 'low' | null;
  routeFinal: string | null;

  executionTrace: ExecutionStep[];
  executionResult:
    | 'success'
    | 'failed'
    | 'pending'
    | 'rejected'
    | 'blocked_needs_auth'    // Waiting for user to complete OAuth
    | 'blocked_auth_expired'; // Had auth, it expired

  verificationState:
    | 'human_verified'
    | 'ai_certain'
    | 'ai_uncertain'
    | 'failed'
    | 'pending';

  retiredFromTests: boolean;
  retiredReason: string | null;
}

export interface ExecutionStep {
  step: 'parse' | 'dispatch' | 'route_validate' | 'execute' | 'mastermind' | 'evolve';
  timestamp: string;
  input: unknown;
  output: unknown;
  codeVersion: string;
  durationMs: number;
}

export interface EvolverResult {
  action: 'evolved' | 'skipped' | 'failed';
  triggers?: RouteTrigger[];
  transform?: string;
  reasoning: string;
  validationPassed?: boolean;
  validationErrors?: string[];
  retriesUsed?: number;
}

export interface RouteVersion {
  version: number;
  timestamp: string;
  triggers: RouteTrigger[];
  transformScript: string | null;
  reason: string;
  evolvedFrom?: string; // The input that triggered evolution
}

export interface Route {
  id: string;
  name: string;
  description: string;

  triggers: RouteTrigger[];

  schema: string | null;
  recentItems: CaptureRef[];

  destinationType: 'fs' | 'intend';
  destinationConfig:
    | { filePath: string }  // fs
    | { baseUrl: string };  // intend
  transformScript: string | null;

  createdAt: string;
  createdBy: 'user' | 'mastermind';
  lastUsed: string | null;

  versions?: RouteVersion[]; // Version history, newest first
}

export interface RouteTrigger {
  type: 'prefix' | 'regex' | 'keyword' | 'semantic';
  pattern: string;
  priority: number;
}

export interface CaptureRef {
  captureId: string;
  raw: string;
  timestamp: string;
  wasCorrect: boolean;
}

export interface IntendTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;  // ISO 8601
  baseUrl: string;
}

export interface IntegrationConfig {
  intend?: IntendTokens;
}

export interface Config {
  authToken: string;
  requireApproval: boolean;
  approvalGuardPrompt: string | null;
  mastermindRetryAttempts: number;
  integrations?: IntegrationConfig;
}

export interface ParseResult {
  explicitRoute: string | null;
  payload: string;
  metadata: Record<string, string>;
}

export interface DispatchResult {
  routeId: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  reason: string;
}

export interface MastermindAction {
  action: 'route' | 'create' | 'clarify' | 'inbox';
  routeId?: string;
  route?: Omit<Route, 'id' | 'createdAt' | 'lastUsed' | 'recentItems'>;
  question?: string;
  reason: string;
}

/**
 * Test case for evolver prompt iteration.
 * Saved automatically for:
 * 1. Last 5 evolver calls (rolling window)
 * 2. Any call that resulted in evolution (ratchet cases - never deleted)
 */
export interface EvolverTestCase {
  id: string;
  timestamp: string;

  // The full context shown to evolver
  input: {
    newInput: string;
    routeId: string;
    routeName: string;
    routeTriggers: RouteTrigger[];
    routeDescription: string;
    routeRecentItems: string[];
    mastermindReason: string;
  };

  // What happened
  expectedAction: 'skip' | 'evolved';
  expectedTriggers?: RouteTrigger[];  // If evolved
  actualResult: EvolverResult;

  // For replay
  promptUsed: string;
  promptVersion: string;  // Hash of prompt template for detecting changes

  // Classification
  isRatchetCase: boolean;  // True if evolution happened - these are never auto-deleted
  wasRegression: boolean;  // Did a prompt change break this?
}
