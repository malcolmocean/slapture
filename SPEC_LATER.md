# Slapture: Later Phases Spec (Phases 2-6)

This document covers phases 2-6 of Slapture development. Phase 1 (core routing system) is in SPEC_INITIAL.md.

Each phase builds on the previous. Don't skip phases—the trust and testing infrastructure from earlier phases is necessary for later ones to work safely.

---

## Phase 2: Real Integration (intend.do)

### Goal

Establish the OAuth pattern with a real integration. Prove that captures can flow to actual external services, not just dummy destinations.

### Why intend.do First

- Malcolm controls the OAuth server (can debug both sides)
- Simple API surface (add intention)
- Test credentials available: username `qtess`, password `q`, auth_token `4yzflqxhxjjlwhfr06va`
- If OAuth is broken, we know to stop and fix—don't fight unclear issues

### New Destination Type

```typescript
interface IntendDestination {
  type: 'intend';
  config: {
    baseUrl: string;  // https://intend.do
    // OAuth tokens stored separately in secure config
  };
}
```

### Capture States for Auth

Add to capture model:

```typescript
// Additional execution results
executionResult: 
  | 'success' 
  | 'failed' 
  | 'pending' 
  | 'rejected'
  | 'blocked_needs_auth'   // NEW: waiting for user to complete OAuth
  | 'blocked_auth_expired'; // NEW: had auth, it expired
```

When a capture routes to intend.do but OAuth isn't set up:
1. Capture enters `blocked_needs_auth` state
2. Stored with full context of what it wanted to do
3. Dashboard (Phase 3) surfaces these for user action
4. Once auth is complete, blocked captures can be retried

### OAuth Flow

1. User clicks "Connect intend.do" (in dashboard, Phase 3, or simple /connect/intend endpoint for now)
2. Redirect to intend.do OAuth authorize URL
3. User approves
4. Callback receives code, exchanges for tokens
5. Tokens stored in `/data/config.json` under `integrations.intend`
6. Blocked captures become retryable

### Test Examples

```
Setup: intend.do OAuth configured

Input: "intend: prepare amazon returns for tomorrow morning"
Expected:
  - Parser: explicitRoute="intend", payload="prepare amazon returns for tomorrow morning"
  - Dispatcher: matches "intend" route
  - Execution: POST to intend.do API to add intention
  - intend.do receives new intention
  - Status: success
```

```
Setup: intend.do OAuth NOT configured

Input: "intend: buy groceries"
Expected:
  - Dispatcher: matches "intend" route
  - Execution: attempts to use intend integration, no auth
  - Status: blocked_needs_auth
  - Capture stored, waiting for auth
```

```
Test: Complete OAuth flow via Playwright
- Navigate to /connect/intend
- Get redirected to intend.do
- Log in as qtess/q
- Approve OAuth
- Get redirected back
- Verify tokens stored
- Verify previously blocked capture now retryable
```

### Implementation Notes

- Use standard OAuth 2.0 authorization code flow
- Store refresh tokens, handle token refresh automatically
- Log all auth-related events for debugging
- If intend.do OAuth seems broken, surface clear error—don't retry forever

---

## Phase 3: Dashboard + Feedback

### Goal

Give the user visibility into the system and ability to provide feedback that improves routing.

### Dashboard Features

**Capture list view:**
- Recent captures with status indicators
- Filter by: all, pending review, failed, needs auth
- Search/filter by route, date, content

**Capture detail view:**
- Full execution trace (expandable)
- What code ran at each step (version hashes)
- "Verify correct" button → sets `human_verified`
- "This was wrong" → opens correction flow

**Correction flow:**
- "Where should this have gone?" → select existing route or describe new one
- System learns from correction (updates triggers, adds to negative examples)
- Option to "retire" old captures that are no longer representative

**Route management:**
- List all routes with stats (total items, success rate, last used)
- View/edit route triggers manually
- View few-shot examples for each route
- Add/remove examples from the test set

**Auth status:**
- Which integrations are connected
- Which have pending captures blocked
- Re-auth / disconnect buttons

### Test Suite View

- All human-verified captures as "golden" tests
- Run new route changes against test suite before deploying
- Show which captures would be re-routed by a proposed change
- Allow retiring outdated test cases

### Implementation Notes

- Simple server-rendered HTML is fine (or minimal React)
- No need for real-time updates—refresh to see changes
- Mobile-friendly but desktop-first
- Auth: same token as API, or simple session

### Test Examples

```
Test: Verify a capture
- View capture that executed successfully
- Click "Verify correct"
- Capture.verificationState changes to 'human_verified'
- Capture appears in test suite
```

```
Test: Correct a misrouted capture
- View capture that went to wrong route
- Click "This was wrong"
- Select correct route
- System updates route triggers to avoid this error
- Original capture marked as negative example for wrong route
```

```
Test: Test suite validation
- Create new trigger for existing route
- System runs against test suite
- Shows "This change would re-route 3 verified captures"
- User can proceed (and retire those) or cancel
```

---

## Phase 4: LLM Validation Layer

### Goal

Add semantic intelligence at the route level so that pattern-matched routes can reject obviously wrong items before execution.

### Architecture Change

Route handlers gain an optional LLM validation step:

```typescript
interface Route {
  // ... existing fields ...
  
  validation: {
    enabled: boolean;
    model: 'haiku' | 'sonnet';  // fast and cheap
    prompt: string | null;       // custom prompt, or use default
    confidenceThreshold: number; // 0-1, below this → reject to mastermind
  };
}
```

### Default Validation Prompt

```
You are validating whether an input belongs to the "{routeName}" route.

Route description: {description}
Expected format: {schema}

Recent items that correctly belong here:
{last 5 items with timestamps}

Items that were incorrectly sent here:
{negative examples if any}

New input to validate:
"{payload}"

Does this input belong to this route?
- If YES: {"decision": "accept", "confidence": 0.95}
- If NO: {"decision": "reject", "confidence": 0.9, "reason": "..."}
- If UNCERTAIN: {"decision": "uncertain", "confidence": 0.6, "reason": "..."}

Consider: does this match the pattern of recent items? Does it fit the expected format?
Respond with JSON only.
```

### Validation Flow

1. Dispatcher proposes route (with confidence)
2. If route has validation enabled:
   - Call Haiku/Sonnet with validation prompt
   - If accept with high confidence → execute
   - If reject → send to Mastermind with rejection reason
   - If uncertain → depends on dispatcher confidence:
     - High dispatcher + uncertain LLM → execute but mark ai_uncertain
     - Low dispatcher + uncertain LLM → send to Mastermind
3. If route has validation disabled → execute (Phase 1 behavior)

### Test Examples

```
Setup: weightlog route with validation enabled

Input: "weight 88.2kg"
Expected:
  - Dispatcher: matches weightlog
  - Validation: Haiku sees recent weights, accepts with 0.95 confidence
  - Execution: proceeds
```

```
Input: "weight of evidence suggests we should pivot"
Expected:
  - Dispatcher: matches weightlog (regex hit on "weight")
  - Validation: Haiku sees recent weights (88.2kg, 88.1kg, etc.)
  - Haiku: "reject, 0.95 confidence, this is a phrase not a measurement"
  - Mastermind: handles, probably routes to inbox or creates new route
```

```
Input: "baby weight 10.3kg"
Expected:
  - Dispatcher: matches weightlog
  - Validation: Haiku notices this is different (baby, much lower number)
  - Haiku: "uncertain, 0.5 confidence, might be separate baby weight tracking"
  - Mastermind: decides whether to create new route or ask for clarification
```

### Few-Shot Context Management

Each route maintains:
- Last N successful items (configurable, default 10)
- Negative examples (items rejected or corrected)
- Both dated, for temporal context

This context is:
- Shown to validation LLM
- Used by Mastermind when creating/modifying routes
- Part of what makes routes "learn" over time

### Anomaly Detection

Beyond schema fit, validation can catch:
- Unusual values (weight 500kg when typical is 80-90kg)
- Missing expected components (no unit when units always present)
- Temporal anomalies (data point from "yesterday" when it's a real-time tracker)

The prompt can be enhanced per-route to catch route-specific anomalies.

---

## Phase 5: Mastermind Uses Integrations

### Goal

Upgrade the Mastermind from Opus-via-API to Opus-in-Claude-Code, giving it the ability to browse, search, and use existing integrations to understand novel inputs.

### Why This Matters

When a novel input arrives like "log movie reco Terminator 2 in my usual place," the Mastermind needs to:
1. Search existing integrations to find where movie recs go
2. Look at the format/schema there
3. Create a route that writes in that format

This requires tool use beyond just generating JSON—it needs to actually interact with systems.

### Architecture

Reference implementation: https://github.com/KyleHerndon/opus-orchestra/

```
┌─────────────────┐
│  HTTP Server    │  (unchanged from Phase 1)
└────────┬────────┘
         │ capture needing mastermind
         ▼
┌─────────────────┐
│  Mastermind     │  Now: Claude Code in tmux session
│  Orchestrator   │  Can spawn, communicate, restart
└────────┬────────┘
         │ tool calls
         ▼
┌─────────────────┐
│  Available      │  - File system (read routes, captures, traces)
│  Tools          │  - Integrations (search Roam, read spreadsheets)
│                 │  - Code execution (test new routes)
│                 │  - Route management (create, modify)
└─────────────────┘
```

### Mastermind Session Management

- Supervisor process monitors tmux session
- If session dies or gets stuck, restart with fresh context
- Session can `/clear` itself if context gets too long
- Cold start is cheap—don't try to maintain long-running state

### Tool Definitions

```typescript
// File system
readFile(path: string): string
writeFile(path: string, content: string): void
listDirectory(path: string): string[]

// Route management  
getRoutes(): Route[]
getRoute(id: string): Route
createRoute(route: Partial<Route>): Route
updateRoute(id: string, changes: Partial<Route>): Route
testRouteAgainstHistory(routeId: string): TestResult[]

// Integrations (varies by what's connected)
intend_listIntentions(): Intention[]
intend_addIntention(text: string): void
sheets_readRange(sheetId: string, range: string): any[][]
sheets_appendRow(sheetId: string, row: any[]): void
roam_search(query: string): Block[]
roam_createBlock(parentUid: string, text: string): void

// Code execution
executeScript(script: string): { stdout: string, stderr: string, exitCode: number }
```

### Test Examples

```
Setup: User has Roam connected, movie recs exist in Roam under #movie-recs

Input: "movie reco Terminator 2 from Bob"
Mastermind process:
  1. No route matches
  2. Mastermind searches Roam for "movie" related content
  3. Finds #movie-recs page with existing entries
  4. Observes format: "- [[Movie Name]] - recommended by [[Person]]"
  5. Creates route:
     - trigger: regex /^movie reco/i
     - destination: roam
     - transform: converts "movie reco {title} from {person}" to Roam format
  6. Tests route doesn't interfere with existing routes
  7. Executes for current input
Expected:
  - New block in Roam: "- [[Terminator 2]] - recommended by [[Bob]]"
  - New route available for future movie recs
```

```
Input: "weight 79.9kg" (first time, no weight route yet)
Mastermind process:
  1. No route matches
  2. Searches integrations for "weight" content
  3. Finds Google Sheet with weight log
  4. Observes format: columns Date, Weight (kg)
  5. Creates route with sheets destination
  6. Executes
Expected:
  - New row in sheet with today's date and 79.9
  - Route created for future weight logs
```

### Error Recovery

When Mastermind fails or gets confused:
1. Log full context of what it was trying to do
2. Capture goes to slapture inbox
3. User can manually route and provide feedback
4. Next similar input benefits from the feedback

### Security Considerations

- Claude Code runs with file system access—sandboxed to /data directory
- Integration credentials are available but treated carefully
- All actions logged in execution trace
- Human can review what Mastermind did before verifying

---

## Phase 6: Mastermind Creates Integrations

### Goal

The Mastermind can write new OAuth flows and integration code, enabling self-improvement where novel inputs lead to new capabilities.

### The Self-Improvement Loop

1. Input arrives that would need a new integration (e.g., "add to my Spotify playlist")
2. Mastermind recognizes it could handle this with Spotify API access
3. Mastermind writes:
   - OAuth configuration for Spotify
   - API client code
   - Route that uses the new integration
4. New code is tested against historical data
5. If tests pass, integration is available
6. User completes OAuth
7. Original input (and future similar) can now route successfully

### Architecture

```
┌─────────────────┐
│  Mastermind     │  Full Claude Code capabilities
│  (Opus)         │  --dangerously-skip-permissions in sandboxed container
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Code           │  - Write new integration files
│  Generation     │  - Write OAuth config
│                 │  - Write route handlers
│                 │  - Write tests
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Validation     │  - Run new code against test suite
│                 │  - Check for regressions
│                 │  - Verify OAuth flow works (with test creds if available)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Deployment     │  - Hot reload new integration
│                 │  - Or: queue for user approval (configurable)
└─────────────────┘
```

### When to Auto-Deploy vs. Require Approval

Configurable thresholds:

```typescript
interface AutoDeployConfig {
  // Auto-deploy if:
  newRoutesWithExistingIntegrations: boolean;  // true: just routing, safe
  routeModifications: boolean;                  // true if test suite passes
  
  // Require approval if:
  newIntegrations: boolean;                     // new OAuth, new API client
  changesAffectingNPlusCaptures: number;        // e.g., 10 - if change would reroute many items
  touchesAuth: boolean;                         // any auth-related changes
}
```

Default: conservative. Require approval for new integrations, auto-deploy route changes that pass tests.

### Integration Template

When Mastermind creates a new integration, it follows a template:

```typescript
// /integrations/{name}/
//   config.ts      - OAuth URLs, scopes, client ID placeholder
//   client.ts      - API client with typed methods
//   routes.ts      - Default routes that use this integration
//   tests/         - Integration-specific tests

interface IntegrationManifest {
  name: string;
  authType: 'oauth2' | 'api_key' | 'none';
  oauthConfig?: {
    authorizeUrl: string;
    tokenUrl: string;
    scopes: string[];
  };
  requiredSecrets: string[];  // e.g., ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET']
  capabilities: string[];     // e.g., ['read_playlists', 'add_to_playlist']
}
```

### Test Examples

```
Input: "add Shape of You to my workout playlist on Spotify"
Current state: No Spotify integration

Mastermind process:
  1. Recognizes this needs Spotify API
  2. Researches Spotify API (web search or built-in knowledge)
  3. Generates:
     - integrations/spotify/config.ts with OAuth setup
     - integrations/spotify/client.ts with addToPlaylist method
     - integrations/spotify/routes.ts with playlist route
  4. Tests compile, no regressions
  5. Integration queued for approval
  
User flow:
  1. Dashboard shows "New integration available: Spotify"
  2. User reviews generated code (optional)
  3. User provides client ID/secret (from Spotify developer dashboard)
  4. User clicks "Connect Spotify", completes OAuth
  5. Original capture retried, succeeds
  
Expected outcome:
  - Song added to playlist
  - Future "add X to Y playlist" captures route automatically
```

```
Input: "update bookantt spreadsheet: 10mins on Heart of Enterprise today"
Current state: Sheets connected, but no bookantt-specific route

Mastermind process:
  1. Searches connected sheets for "bookantt"
  2. Finds spreadsheet with reading time tracking
  3. Observes format: columns Date, Book, Minutes
  4. Creates route (no new integration needed)
  5. Auto-deploys (existing integration, test suite passes)
  
Expected:
  - New row: today's date, "Heart of Enterprise", 10
  - Route created for future bookantt updates
```

### Guardrails

- All generated code is logged and reviewable
- Test suite must pass before any deployment
- Auth-touching changes always need approval
- Mastermind can't modify its own orchestration code
- Container isolation limits blast radius of bugs

### The Recursive Vision

At this phase, Slapture becomes self-improving in a meaningful sense:

- User captures "I wish slapture could do X"
- Mastermind reads this (it's routed to slapture inbox or a meta route)
- Mastermind attempts to build X
- If successful, X becomes available
- The capture that requested X can now be processed

The app is improved through the app itself. Novel inputs that can't be handled become requests for new capabilities.

---

## Cross-Phase Considerations

### Testing Philosophy

Every capture is potential test data. The states:
- `human_verified`: Gold standard, always in test suite
- `ai_certain`: High confidence, included with lower weight
- `ai_uncertain`: Excluded from test suite but kept for analysis
- `failed`: Negative examples, used differently

New routes/changes validated against this corpus before deployment.

### Execution Traces as Debug Data

Every step records:
- Input/output
- Code version (hash)
- Timing
- Model used (if LLM involved)

When something breaks, the Mastermind can diff traces: "this worked 3 days ago with code version X, now fails with version Y."

### Progressive Disclosure Principle

User sees:
- Widget: just current capture status
- Dashboard: as much detail as they want
- Code: full implementation if they're curious

System builds trust by being transparent about what it's doing and why.

### Graceful Degradation

If any component fails:
- Captures never disappear
- Failed state is explicit
- User can always manually process
- System learns from manual corrections

---

## Success Criteria by Phase

### Phase 2
- [ ] intend.do OAuth flow works end-to-end
- [ ] Captures can route to intend.do and create intentions
- [ ] Blocked-needs-auth state works correctly
- [ ] Playwright tests cover OAuth flow with test credentials

### Phase 3
- [ ] Dashboard shows all captures with filtering
- [ ] User can verify captures (sets human_verified)
- [ ] User can correct misrouted captures
- [ ] Route editing works
- [ ] Test suite view shows verified captures
- [ ] Changes validated against test suite

### Phase 4
- [ ] LLM validation prevents "weight of evidence" → weightlog
- [ ] Few-shot context maintained per route
- [ ] Uncertain items handled appropriately
- [ ] Validation improves with more examples

### Phase 5
- [ ] Mastermind runs in Claude Code (tmux/opus-orchestra pattern)
- [ ] Can search/read from connected integrations
- [ ] Can create routes based on discovered formats
- [ ] Session management handles crashes/restarts

### Phase 6
- [ ] Mastermind can write new integration code
- [ ] Generated code passes tests before deployment
- [ ] Approval flow for new integrations
- [ ] At least one integration fully created by Mastermind
- [ ] Self-improvement loop demonstrated end-to-end

---

## Reference

For foundational architecture and rationale, see the design conversation: ORIGINAL_CHAT_CONTEXT.md.

For Phase 1 implementation details, see SPEC_INITIAL.md.

For tmux/Claude Code orchestration pattern, see: https://github.com/KyleHerndon/opus-orchestra/
