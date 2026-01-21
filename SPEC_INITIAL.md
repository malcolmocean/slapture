# Slapture: Initial Spec (Phase 1)

## Overview

Slapture is a capture system that intelligently routes arbitrary text inputs to appropriate destinations. The core insight: instead of everything landing in an inbox for later processing, the system should route captures directly to where they belong—spreadsheets, task managers, code repos, notes—using a combination of deterministic rules and LLM-powered interpretation.

This spec covers Phase 1: a working end-to-end system with dummy destinations, establishing the core architecture that later phases will build upon.

## Architecture

```
┌─────────────────┐
│  Input Layer    │  Web widget (later: Android widget, Alfred, etc.)
└────────┬────────┘
         │ raw text
         ▼
┌─────────────────┐
│  HTTP Server    │  Receives captures, serves widget UI, exposes API
└────────┬────────┘
         │ 
         ▼
┌─────────────────┐
│  Parser         │  Extracts: explicit route hint, payload, metadata
└────────┬────────┘
         │ structured capture
         ▼
┌─────────────────┐
│  Dispatcher     │  Pattern-matches against rules, proposes route
│                 │  If no match or low confidence → Mastermind
└────────┬────────┘
         │ proposed route + confidence
         ▼
┌─────────────────┐
│  Route Handler  │  Validates fit, transforms payload, executes
│  (per-route)    │  Can reject → back to Mastermind
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Destination    │  Phase 1: write-to-file, post-to-url
└─────────────────┘

┌─────────────────┐
│  Mastermind     │  Opus via Anthropic API (not Claude Code yet)
│                 │  Handles: new routes, rejections, ambiguity
│                 │  Can generate new deterministic rules
└─────────────────┘
```

## Core Concepts

### Capture

A capture is a single text input from the user. It moves through the system and accumulates metadata:

```typescript
interface Capture {
  id: string;                    // unique identifier
  raw: string;                   // original input text
  timestamp: string;             // ISO 8601
  
  // Parser output
  parsed: {
    explicitRoute: string | null;  // e.g., "autocode" from "autocode: do thing"
    payload: string;               // the actual content
    metadata: Record<string, string>;  // extracted hints like "from Bob"
  } | null;
  
  // Routing
  routeProposed: string | null;  // which route dispatcher suggested
  routeConfidence: 'high' | 'medium' | 'low' | null;
  routeFinal: string | null;     // where it actually went
  
  // Execution
  executionTrace: ExecutionStep[];
  executionResult: 'success' | 'failed' | 'pending' | 'rejected';
  
  // Verification
  verificationState: 
    | 'human_verified'      // user explicitly confirmed correct
    | 'ai_certain'          // executed successfully, high confidence
    | 'ai_uncertain'        // executed but some doubt
    | 'failed'              // execution error or rejection
    | 'pending';            // not yet processed
  
  // For test suite management
  retiredFromTests: boolean;     // user marked as outdated
  retiredReason: string | null;
}

interface ExecutionStep {
  step: string;           // 'parse' | 'dispatch' | 'route_validate' | 'execute' | 'mastermind'
  timestamp: string;
  input: any;
  output: any;
  codeVersion: string;    // hash or identifier of the code that ran
  durationMs: number;
}
```

### Route

A route is a destination type with associated rules, context, and execution logic:

```typescript
interface Route {
  id: string;
  name: string;                    // e.g., "weightlog", "file-dump"
  description: string;             // human and LLM readable
  
  // Matching
  triggers: RouteTrigger[];        // how dispatcher identifies this route
  
  // Context for validation
  schema: string | null;           // description of expected payload format
  recentItems: CaptureRef[];       // last N items sent here (for few-shot)
  
  // Execution
  destinationType: 'write-to-file' | 'post-to-url';  // Phase 1 only
  destinationConfig: Record<string, any>;
  transformScript: string | null;  // optional JS to transform payload before send
  
  // Metadata
  createdAt: string;
  createdBy: 'user' | 'mastermind';
  lastUsed: string | null;
}

interface RouteTrigger {
  type: 'prefix' | 'regex' | 'keyword' | 'semantic';
  pattern: string;
  priority: number;  // higher = checked first
}

interface CaptureRef {
  captureId: string;
  raw: string;
  timestamp: string;
  wasCorrect: boolean;  // for few-shot context
}
```

### Mastermind

In Phase 1, the Mastermind is Opus called via Anthropic API (not Claude Code). It handles:

1. **Novel inputs**: No route matches, or dispatcher confidence is low
2. **Rejections**: Route handler says "this doesn't fit my schema"
3. **Rule generation**: Creates new RouteTriggers or even new Routes
4. **Ambiguity resolution**: When input could match multiple routes

The Mastermind prompt should include:
- All existing routes (names, descriptions, triggers, recent items)
- The current capture being processed
- Instruction to consider alternative interpretations and reject only clearly wrong ones
- Ability to: propose a route, create a new route, request clarification, or send to slapture inbox

## Components

### HTTP Server

Simple Express/Fastify server with endpoints:

- `POST /capture` - Submit a new capture (body: `{ text: string }`)
- `GET /status/:captureId` - Get capture status and execution trace
- `GET /widget` - Serve the web widget HTML
- `GET /routes` - List all routes (for debugging/dashboard prep)
- `GET /captures` - List recent captures (for debugging/dashboard prep)

Auth for Phase 1: Simple URL-based token query param (`?token=xyz`). Single token stored in config file.

### Parser

Extracts structure from raw input. Patterns to recognize:

1. **Prefix with colon**: `autocode: add feature` → explicitRoute: "autocode", payload: "add feature"
2. **Hashtag prefix**: `#tweet hello world` → explicitRoute: "tweet", payload: "hello world"
3. **Parenthetical suffix**: `movie reco Terminator 2 (from Bob)` → payload: "movie reco Terminator 2", metadata: {source: "Bob"}
4. **Implicit structure**: `weight 88.2kg` → payload: "weight 88.2kg", metadata: {detectedType: "measurement"}

Parser should be deterministic (no LLM calls). If structure is ambiguous, pass full text as payload with null explicitRoute.

### Dispatcher

Matches parsed capture against route triggers:

1. If `explicitRoute` matches a route name or trigger prefix → propose that route (high confidence)
2. Else, check all triggers in priority order
3. If single match → propose (medium confidence)
4. If multiple matches → propose highest priority (low confidence, flag for validation)
5. If no matches → send to Mastermind

Dispatcher is deterministic. No LLM calls.

### Route Handler

Each route has a handler that:

1. **Validates** the payload fits the route's schema/expectations
2. **Transforms** the payload if transformScript is defined
3. **Executes** the destination write

In Phase 1, validation is simple (can be just "non-empty string"). Later phases add LLM validation.

If validation fails, capture is rejected back to Mastermind with reason.

### Destinations (Phase 1)

**write-to-file**:
```typescript
config: {
  directory: string;  // e.g., "./captures/weightlog"
  filenamePattern: string;  // e.g., "{date}.txt" or "{id}.json"
  format: 'raw' | 'json';
}
```

**post-to-url**:
```typescript
config: {
  url: string;
  method: 'POST' | 'PUT';
  headers: Record<string, string>;
  bodyTemplate: string;  // e.g., '{"text": "{payload}", "timestamp": "{timestamp}"}'
}
```

For testing post-to-url, include a tiny echo server that logs received posts.

### Storage (File-based)

```
/data
  /captures
    /{captureId}.json       # individual capture records
  /routes
    /{routeId}.json         # route definitions
  /executions
    /{captureId}-trace.json # detailed execution traces
  /config.json              # auth tokens, settings
```

This structure makes it easy for Claude Code (in later phases) to inspect and modify data.

### Web Widget

Single-page HTML/JS that:

1. Shows a text input field
2. On submit, POSTs to /capture
3. If user stays on page, polls /status/:captureId and shows progressive updates:
   - "Parsing..."
   - "Matched: {routeName}" or "No match, consulting mastermind..."
   - "Executing..."
   - "✓ Sent to {routeName}" or "✗ Failed: {reason}"

Minimal styling. This will eventually be embedded in Android WebView.

No notifications, no red dots, no historical data. Just current capture status.

## Test Examples

These examples define expected behavior. Implement as Playwright tests.

### Example Set A: Basic routing with explicit hints

Setup: Two routes pre-configured
- Route "dump" with trigger prefix "dump:", destination write-to-file in ./captures/dump/
- Route "echo" with trigger prefix "echo:", destination post-to-url to local echo server

```
Input: "dump: this is a test"
Expected:
  - Parser: explicitRoute="dump", payload="this is a test"
  - Dispatcher: proposes "dump" (high confidence)
  - Execution: writes to ./captures/dump/{id}.txt containing "this is a test"
  - Status: success
```

```
Input: "echo: hello world"
Expected:
  - Parser: explicitRoute="echo", payload="hello world"
  - Dispatcher: proposes "echo" (high confidence)
  - Execution: POSTs to echo server
  - Echo server receives: {"text": "hello world", "timestamp": "..."}
  - Status: success
```

### Example Set B: No match → Mastermind

Setup: Same two routes, no pattern for "weight" yet

```
Input: "weight 88.2kg"
Expected:
  - Parser: explicitRoute=null, payload="weight 88.2kg"
  - Dispatcher: no trigger match → Mastermind
  - Mastermind: sees available routes, recognizes this doesn't fit either
  - Mastermind: creates new route "weightlog" with:
    - trigger: regex /^weight\s+[\d.]+\s*(kg|lbs?|lb)?$/i
    - destination: write-to-file in ./captures/weightlog/
  - Execution: writes to ./captures/weightlog/{date}.txt
  - Status: success
```

```
Input: "weight 88.1kg"  (second time, route exists)
Expected:
  - Dispatcher: matches "weightlog" route (high confidence)
  - No Mastermind needed
  - Execution: appends to ./captures/weightlog/{date}.txt
  - Status: success
```

### Example Set C: Ambiguity handling

Setup: After Example Set B, "weightlog" route exists

```
Input: "weight of evidence suggests we should pivot"
Expected:
  - Dispatcher: regex matches "weight" → proposes "weightlog"
  - Route handler: validates payload... but wait, Phase 1 has simple validation
  - This is where Phase 4's LLM validation would catch it
  - For Phase 1: this might incorrectly route. That's okay—we document it as known limitation.
```

### Example Set D: Progressive UI status

```
Test: Submit "dump: test" via widget, observe status updates
Expected sequence in UI:
  1. "Processing..."
  2. "Matched: dump"
  3. "Executing..."
  4. "✓ Sent to dump"
  
Test: Submit "unknown thing that mastermind handles" via widget
Expected sequence:
  1. "Processing..."
  2. "No match, analyzing..."
  3. "Mastermind creating route..."
  4. "Executing..."
  5. "✓ Sent to {newRouteName}"
```

### Example Set E: Execution failure

```
Setup: Route "echo" pointing to URL that's down

Input: "echo: test"
Expected:
  - Dispatcher: matches "echo"
  - Execution: POST fails
  - ExecutionTrace: includes error details
  - Status: failed
  - Capture stays in system with failed state for later retry/debug
```

## Implementation Notes

### Language: TypeScript

Chosen because:
- Claude Code is fluent in it
- Type system catches plumbing errors
- Good ecosystem for serverless/edge if needed later
- Tests integrate well (Jest/Vitest + Playwright)

### Testing Strategy

1. **Unit tests**: Parser, Dispatcher, individual route handlers
2. **Integration tests**: Full flow from HTTP endpoint to destination
3. **Playwright E2E**: Widget UI states, progressive disclosure

All historical captures serve as regression tests. When adding/modifying routes, run against historical data to detect unintended re-routing.

### Mastermind Prompt Structure (Phase 1)

```
You are the Slapture Mastermind. You handle captures that couldn't be automatically routed.

Current routes:
{for each route: name, description, triggers, last 3 items}

Capture to process:
- Raw: "{raw}"
- Parsed: {parsed}
- Dispatcher result: {why it came to you}

Your options:
1. Route to existing: {"action": "route", "routeId": "...", "reason": "..."}
2. Create new route: {"action": "create", "route": {...}, "reason": "..."}
3. Need clarification: {"action": "clarify", "question": "..."}
4. Send to inbox: {"action": "inbox", "reason": "..."}

Consider alternative interpretations. Only reject alternatives that are clearly absurd.
If the input is ambiguous between reasonable interpretations, choose "clarify".

Respond with JSON only.
```

### Error Handling

- All errors logged with full context
- Captures never disappear—failed state is explicit
- Mastermind failures → capture goes to slapture inbox with error context

### File Watching (Optional Enhancement)

Consider: watch ./data/routes/ for manual edits, reload on change. Makes it easy to hand-edit routes during development.

## Out of Scope for Phase 1

- OAuth / real integrations (Phase 2)
- Dashboard UI for reviewing captures (Phase 3)
- LLM validation at route level (Phase 4)
- Claude Code / tmux mastermind (Phase 5)
- Self-improvement loop (Phase 6)
- Compound captures ("and" / "then")
- Android widget (after Phase 1 web widget is solid)
- Multiple auth tokens (single token is fine)

## Success Criteria

Phase 1 is complete when:

1. [ ] HTTP server runs, accepts captures, serves widget
2. [ ] Parser extracts explicit routes and basic metadata
3. [ ] Dispatcher matches against configured triggers
4. [ ] Two destinations work (write-to-file, post-to-url)
5. [ ] Mastermind (Opus API) handles novel inputs and creates routes
6. [ ] Widget shows progressive status updates
7. [ ] All Example Sets A-E pass as Playwright tests
8. [ ] Captures stored with full execution traces
9. [ ] Verification states tracked (pending/success/failed for now)

## Reference

For architectural decisions and rationale, see the design conversation: ORIGINAL_CHAT_CONTEXT.md.

For later phases, see SPEC_LATER.md.
