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
  executionResult: 'success' | 'failed' | 'pending' | 'rejected';

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

  destinationType: 'fs';
  destinationConfig: {
    filePath: string;
  };
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

export interface Config {
  authToken: string;
  requireApproval: boolean;
  approvalGuardPrompt: string | null;
  mastermindRetryAttempts: number;
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
