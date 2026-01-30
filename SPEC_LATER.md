# Slapture: Later Phases Spec (Phases 5-6)

This document covers phases 5-6 of Slapture development—the mastermind evolution phases.

For earlier phases, see:
- SPEC_INITIAL.md - Phase 1 (core routing system)
- SPEC_CORE.md - Phases 2-4 (integrations, dashboard, LLM validation)

## Completed Phases Summary

### Phase 1 (SPEC_INITIAL.md)
- [x] Core routing system with regex triggers
- [x] Capture storage and execution traces
- [x] Basic dispatcher and route matching

### Phase 2
- [x] intend.do OAuth flow works end-to-end
- [x] Captures can route to intend.do and create intentions
- [x] Blocked-needs-auth state works correctly
- [x] Playwright tests cover OAuth flow with test credentials

### Phase 3
- [x] Dashboard shows all captures with filtering
- [x] User can verify captures (sets human_verified)
- [x] User can correct misrouted captures
- [ ] Route editing works
- [x] Test suite view shows verified captures
- [x] Changes validated against test suite

### Phase 4
- [x] LLM validation prevents "weight of evidence" → weightlog
- [x] Few-shot context maintained per route
- [x] Uncertain items handled appropriately
- [x] Validation improves with more examples

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

## Success Criteria

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

## Reference

For foundational architecture and rationale, see the design conversation: ORIGINAL_CHAT_CONTEXT.md.

For Phase 1 implementation details, see SPEC_INITIAL.md.

For Phases 2-4 implementation details, see SPEC_CORE.md.

For tmux/Claude Code orchestration pattern, see: https://github.com/KyleHerndon/opus-orchestra/

## Other ideas/todos

- [ ] At some point we'll need to make sure we use user's timezone for today's date, and maybe also smart dates where 1am friday night is still friday not "uhh ackshully it's saturday morning"
- [ ] User ability to add per-route or per-destination context
  - they should be able to edit that in a UI somewhere
  - but also! they should be able to add those updates by just giving an update to the system AS TOP-LEVEL INPUT!
    - like "intend intentions are only for today, so if something doesn't say 'today' then don't put it there!"
    - or "if I say message Jess, use whatsapp"
- [ ] if it's not sure, it'll ask (- jarred)
