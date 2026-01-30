# Tiered Regression Protection for Trigger Evolution

## Problem

The evolver's regression check treats all historically-routed captures as "correct" and blocks trigger changes that would cause them to no longer match. This prevents legitimate trigger evolution when:

1. Old captures were mis-routed (e.g., "log today's pushups to pushups.csv" routed to `gwen_memories`)
2. User patterns have changed and old triggers are no longer relevant
3. AI made reasonable guesses that turned out wrong

The system should distinguish between confirmed-correct routings and unverified automatic routings.

## Solution: Tiered Protection

Three levels of protection based on `verificationState`:

### HARD BLOCK: `human_verified`

- Human explicitly confirmed this routing was correct
- Cannot be auto-overridden by evolver
- Evolver CAN flag for human review: "I think triggers should change, please review"
- Goes to review queue; human approves or rejects the proposed change

### SOFT BLOCK: `ai_certain`

- AI was confident in the routing, but no human verification
- Evolver CAN override if it provides justification
- Justification logged: "Override: 'X' (ai_certain) - [reason]"
- Flexible reasoning allowed (explicit explanation, confidence statement, or pattern match)

### NO BLOCK: `ai_uncertain`, `pending`, `failed`, `null`

- Routing was automatic or uncertain
- Not included in regression check at all
- These captures are "up for grabs" for re-routing

## Handling Freed Captures

When evolution succeeds and unprotected captures no longer match, the evolver decides per-capture:

| Action | Effect |
|--------|--------|
| `RE_ROUTE` | Capture re-enters pipeline, gets new `routeFinal` |
| `MARK_FOR_REVIEW` | Flagged in dashboard, awaits human decision |
| `LEAVE_AS_HISTORICAL` | Sets `retiredFromTests: true`, excluded from future checks |

Freed captures are presented to the evolver indexed and dated:

```
Freed captures (no longer match proposed triggers):

[1] "log today's pushups to pushups.csv: 10"
    routed: 2026-01-15 (14d ago) | verification: pending

[2] "gwenmemory you look so cute"
    routed: 2026-01-28 (9h ago) | verification: ai_uncertain

For each, respond with: RE_ROUTE, MARK_FOR_REVIEW, or LEAVE_AS_HISTORICAL
```

## Schema Changes

### Capture (existing fields, used more actively)

```typescript
verificationState: 'human_verified' | 'ai_certain' | 'ai_uncertain' | 'pending' | 'failed';
retiredFromTests?: boolean;
retiredReason?: string | null;
```

### Capture (new fields)

```typescript
routingReviewQueued?: boolean;      // Awaiting human decision
suggestedReroute?: string | null;   // Where evolver thinks it should go
```

### TriggerChangeReview (new type)

```typescript
interface TriggerChangeReview {
  id: string;
  routeId: string;
  proposedTriggers: RouteTrigger[];
  evolverReasoning: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';

  affectedCaptures: Array<{
    captureId: string;
    raw: string;
    routedAt: string;
    recommendation: 'RE_ROUTE' | 'MARK_FOR_REVIEW' | 'LEAVE_AS_HISTORICAL';
    suggestedReroute?: string;
    reasoning: string;
  }>;
}
```

## Implementation Touchpoints

### 1. Evolver validation (`src/mastermind/evolver.ts`)

- `validateChanges()` adds tiered checking based on `verificationState`
- Separates captures into: hard-blocked, soft-blocked, unprotected
- Returns soft-blocked list for evolver to potentially override
- Returns freed captures list for evolver to categorize

### 2. Evolver prompt (`src/mastermind/evolver-prompt.ts`)

- New context section: "Soft-protected captures you may override with justification"
- New context section: "Freed captures (indexed, with relative dates)"
- New expected response fields: `overrideJustifications`, `freedCaptureActions`

### 3. Evolver response parsing (`src/mastermind/evolver.ts`)

- Parse new response fields
- Validate soft-block overrides include reasoning
- Validate each freed capture has an action

### 4. Pipeline integration (`src/pipeline/index.ts`)

After successful evolution, execute freed capture actions:
- `RE_ROUTE` → re-dispatch through pipeline
- `LEAVE_AS_HISTORICAL` → set `retiredFromTests: true`
- `MARK_FOR_REVIEW` → set `routingReviewQueued: true`

### 5. Review queue storage (new: `src/storage/trigger-reviews.ts`)

- `saveTriggerReview()`, `getTriggerReviews()`, `updateReviewStatus()`
- Store in `/data/trigger-reviews/{id}.json`

### 6. Dashboard (`src/dashboard/`)

- New section: pending trigger change reviews
- Display: proposed triggers, affected captures with recommendations
- Actions: Approve All, Approve with changes, Reject
- On approve: apply trigger changes, process affected captures per recommendation
