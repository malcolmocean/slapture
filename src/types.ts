export interface Capture {
  id: string;
  raw: string;
  timestamp: string;
  username: string;

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

  /** The payload after pipeline string transform ran (null if no transform or fs destination) */
  transformedPayload?: string | null;

  /** The trigger pattern string that matched this capture in the dispatcher */
  matchedTrigger?: string | null;

  // Tiered regression protection fields
  routingReviewQueued?: boolean;      // Awaiting human decision on re-route
  suggestedReroute?: string | null;   // Route ID evolver thinks it should go to
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

  /** Justifications for overriding soft-blocked (ai_certain) captures, keyed by capture index (1-based) */
  overrideJustifications?: Record<string, string>;

  /** Actions for freed captures, keyed by capture index (1-based) */
  freedCaptureActions?: Record<string, {
    action: FreedCaptureAction;
    suggestedRoute?: string;
    reasoning: string;
  }>;
}

export interface RouteVersion {
  version: number;
  timestamp: string;
  triggers: RouteTrigger[];
  transformScript: string | null;
  reason: string;
  evolvedFrom?: string; // The input that triggered evolution
}

export interface NotesDestinationConfig {
  target: 'integration' | 'destination';
  id: string;
}

/**
 * Sheets destination config - full type in routes/sheets-executor.ts
 * This is a forward declaration to avoid circular imports.
 */
export interface SheetsDestinationConfig {
  spreadsheetId: string;
  sheetName: string;
  operation: unknown;  // Full type: SheetsOperation from sheets-executor.ts
}

/**
 * Roam destination config - full type in integrations/roam/types.ts
 * This is a forward declaration to avoid circular imports.
 */
export interface RoamDestinationConfig {
  graphName: string;
  operation: unknown;  // Full type: RoamOperation from integrations/roam/types.ts
}

/**
 * Configuration for LLM validation at the route level.
 */
export interface RouteValidation {
  enabled: boolean;
  model: 'haiku' | 'sonnet';
  prompt: string | null;  // Custom prompt, or use default template
}

/**
 * Context used for LLM validation - provides few-shot examples.
 */
export interface RouteValidationContext {
  /** Items that were rejected or corrected (didn't belong here) */
  negativeExamples: CaptureRef[];
  /** Items that were plausible/unsure but ultimately belonged */
  edgeCases: CaptureRef[];
}

export interface Route {
  id: string;
  name: string;
  description: string;

  triggers: RouteTrigger[];

  schema: string | null;
  /** Recent successful items (serves as positive examples for validation) */
  recentItems: CaptureRef[];

  destinationType: 'fs' | 'intend' | 'notes' | 'sheets' | 'roam';
  destinationConfig:
    | { filePath: string }           // fs
    | { baseUrl: string }            // intend
    | NotesDestinationConfig         // notes
    | SheetsDestinationConfig        // sheets (see sheets-executor.ts for type)
    | RoamDestinationConfig;         // roam (see integrations/roam/types.ts)
  transformScript: string | null;

  createdAt: string;
  createdBy: 'user' | 'mastermind';
  lastUsed: string | null;

  versions?: RouteVersion[]; // Version history, newest first

  /** LLM validation configuration for this route */
  validation?: RouteValidation;

  /** Context for validation (negative examples, edge cases) */
  validationContext?: RouteValidationContext;
}

/**
 * Named confidence levels for LLM validation.
 * LLMs are bad at numeric confidence - use these semantic levels instead.
 */
export type ValidationConfidence =
  | 'certain'    // Unambiguously same intent as items here → Execute
  | 'confident'  // Very likely same intent, minor surface differences → Execute
  | 'plausible'  // Could belong here, but something's slightly off → Execute, flag for review
  | 'unsure'     // Genuinely ambiguous - could go either way → Mastermind decides
  | 'doubtful'   // Probably doesn't belong, but I see why it matched → Mastermind decides + hygiene signal
  | 'reject';    // Definitely wrong route, matcher is misfiring → Mastermind + trigger route hygiene

/**
 * Statistics tracked per trigger for hygiene analysis.
 */
export interface TriggerStats {
  totalFires: number;
  lastFired: string | null;  // ISO 8601
  validationResults: Record<ValidationConfidence, number>;
}

/**
 * Route trigger/matcher configuration.
 * Phase 4: Only regex type remains. prefix/keyword/semantic were removed.
 */
export interface RouteTrigger {
  type: 'regex';
  pattern: string;
  priority: number;

  /** Draft matchers are hypotheses that need graduation. Live matchers auto-execute. Defaults to 'live'. */
  status?: 'draft' | 'live';

  /** Number of times this trigger has fired (used for draft matcher graduation). Defaults to 0. */
  fireCount?: number;

  /** Statistics for route hygiene analysis. Defaults to empty stats. */
  stats?: TriggerStats;
}

/**
 * Helper to create a trigger with all defaults filled in.
 */
export function createTrigger(
  pattern: string,
  options?: {
    priority?: number;
    status?: 'draft' | 'live';
    fireCount?: number;
    stats?: TriggerStats;
  }
): RouteTrigger {
  return {
    type: 'regex',
    pattern,
    priority: options?.priority ?? 10,
    status: options?.status ?? 'live',
    fireCount: options?.fireCount ?? 0,
    stats: options?.stats ?? {
      totalFires: 0,
      lastFired: null,
      validationResults: {
        certain: 0,
        confident: 0,
        plausible: 0,
        unsure: 0,
        doubtful: 0,
        reject: 0,
      },
    },
  };
}

/**
 * Get trigger status with default
 */
export function getTriggerStatus(trigger: RouteTrigger): 'draft' | 'live' {
  return trigger.status ?? 'live';
}

/**
 * Get trigger stats with defaults
 */
export function getTriggerStats(trigger: RouteTrigger): TriggerStats {
  return trigger.stats ?? {
    totalFires: 0,
    lastFired: null,
    validationResults: {
      certain: 0,
      confident: 0,
      plausible: 0,
      unsure: 0,
      doubtful: 0,
      reject: 0,
    },
  };
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

export interface SheetsTokens {
  accessToken: string;
  refreshToken: string;
}

export interface RoamGraphConfig {
  graphName: string;
  token: string;
  addedAt: string;
}

export interface RoamConfig {
  graphs: RoamGraphConfig[];
}

export interface Integration {
  id: string;                    // 'intend', 'fs', 'notes'
  name: string;                  // 'intend.do', 'Local Files', 'Notes'
  purpose: string;               // "Track daily intentions, todos, goals"
  authType: 'oauth' | 'api-key' | 'none';
}

export interface IntegrationConfig {
  intend?: IntendTokens;
  sheets?: SheetsTokens;
  roam?: RoamConfig;
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
  /** The trigger that matched (for validation context) */
  matchedTrigger?: RouteTrigger;
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

/**
 * Actions the evolver can recommend for freed captures
 * (captures that no longer match after trigger evolution).
 */
export type FreedCaptureAction = 'RE_ROUTE' | 'MARK_FOR_REVIEW' | 'LEAVE_AS_HISTORICAL';

/**
 * A pending trigger change that requires human review.
 * Created when the evolver wants to change triggers but would affect
 * human-verified captures (hard-blocked).
 */
export interface TriggerChangeReview {
  id: string;
  routeId: string;
  proposedTriggers: RouteTrigger[];
  evolverReasoning: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';

  /** Captures affected by this trigger change, with evolver's recommendations */
  affectedCaptures: Array<{
    captureId: string;
    raw: string;
    routedAt: string;
    recommendation: FreedCaptureAction;
    suggestedReroute?: string;  // Route ID if recommendation is RE_ROUTE
    reasoning: string;
  }>;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  createdAt: string;  // ISO 8601
  authProvider: 'email' | 'google';
}

export interface ApiKey {
  id: string;
  name: string;
  keyHash: string;
  prefix: string;       // e.g. "slap_k_a1b2c3d4" or "slap_t_e5f6g7h8"
  temporary: boolean;
  createdAt: string;     // ISO 8601
  expiresAt: string | null;  // null = never (permanent only)
  lastUsedAt: string | null;
  status: 'active' | 'revoked';
}

export interface AuthContext {
  uid: string;
  email: string;
  authMethod: 'firebase' | 'api-key';
  apiKeyId?: string;  // Set when authMethod is 'api-key'
}
