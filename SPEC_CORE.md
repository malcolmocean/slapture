# Slapture: Core Phases Spec (Phases 2-4)

This document covers phases 2-4 of Slapture development. Phase 1 (core routing system) is in SPEC_INITIAL.md. Phases 5-6 (mastermind evolution) are in SPEC_LATER.md.

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

### Intend Intention Format

All intentions sent to intend.do must match the following regex:

```
/^([^\d\sA-Za-z)]{0,3})((?:\d|[A-Z]{2})?(?:,(?:\d|[A-Z]{2}))*)([^\d\sA-Z)]{0,3})(\)+|\/\/)\s+(.*)/u
```

Parsed fields:
- `_c` (capture group 1): extras before code — usually blank, `&` for misc
- `gids` (capture group 2): goal code(s) — a single digit `0-9`, two uppercase letters (e.g. `FI`), empty string, or comma-separated multiples (e.g. `1,FI,3`)
- `c_` (capture group 3): extras after code — usually blank, `*` gets parsed into `★` (starred)
- delimiter (capture group 4): `)` for task, `//` for comment
- `t` (capture group 5): the main intention text

Examples:
- `1) do laundry` → goal 1
- `FI) run 5k` → goal FI (e.g. Fitness)
- `1,FI) run then rest` → goals 1 and FI
- `&) random task` → misc/ungrouped
- `*1) important task` → extras=`*`, goal 1 (starred)
- `) just a task` → no goal code
- `// this is a comment` → comment, not a task

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

Note: the same input may be entered with many different strings. Your job is to discern different *intent*.

eg same intent, different strings:
- later today: do xyz
- do xyz this evening

eg different intent, similar strings:
- gwen height 32"
- jump height 30"

eg same ultimate intent, but needs different treatment:
- weight 88.2kg
- weight 192.9
(the latter is the same-ish figure, but in a different unit)

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

## Success Criteria

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

## Reference

For foundational architecture and rationale, see the design conversation: ORIGINAL_CHAT_CONTEXT.md.

For Phase 1 implementation details, see SPEC_INITIAL.md.

For Phases 5-6 (mastermind evolution), see SPEC_LATER.md.
