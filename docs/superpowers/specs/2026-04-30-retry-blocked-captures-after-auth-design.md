# Retry Blocked Captures After Auth — Design

## Problem

Captures routed to integrations like Sheets, intend.do, or Roam can land in `blocked_needs_auth` or `blocked_auth_expired` when the user lacks valid tokens. The infrastructure for retrying a single capture (`pipeline.retryCapture()`, `POST /retry/:captureId`) already exists, but nothing triggers it after the user completes OAuth. Blocked captures sit indefinitely until the user manually finds and retries each one.

## Goals

- After a user finishes OAuth for an integration, captures previously blocked on that integration retry automatically.
- The user can see what's blocked and what's retrying in a dedicated dashboard view.
- The user retains a manual "Retry" button (per-capture and batch) for whatever fails again.

## Non-goals

- Background sweep or scheduled retries for `blocked_auth_expired` captures without an OAuth event.
- Lazy/opportunistic retry triggered by new incoming captures.
- Parallel retry execution or rate-limit-aware concurrency.
- Retrying captures that failed for non-auth reasons.

## Design

### Components

**1. Storage filter** — `listCapturesBlockedFor(username, integration)`

Adds a method on `StorageInterface`, implemented in both `src/storage/index.ts` (in-memory) and `src/storage/firestore.ts`. Returns the user's `blocked_needs_auth` + `blocked_auth_expired` captures whose `routeFinal` corresponds to the given integration name (`'intend'`, `'sheets'`, `'roam'`). Filtering uses the same pattern already in use in `oauth.ts` (`routeFinal && routeFinal.includes(integration)`), but extracted into one place.

**2. Pipeline batch retry** — `pipeline.retryBlockedForIntegration(username, integration)`

```ts
async retryBlockedForIntegration(
  username: string,
  integration: 'intend' | 'sheets' | 'roam',
): Promise<{ attempted: number; succeeded: number; stillBlocked: number; failed: number }>
```

- Fetches matching captures via the storage filter.
- Sorts ascending by `timestamp` (oldest first).
- Awaits `retryCapture()` for each one sequentially.
- Catches errors per-capture so one failure doesn't halt the batch.
- Returns a summary for logging.

**3. OAuth callback wiring**

In `src/server/oauth.ts`, the success branches of the `intend`, `sheets`, and `roam` OAuth callbacks will, after `installDefaultRoutes()`:

- Read the user's blocked-capture count *before* starting the retry.
- Fire `pipeline.retryBlockedForIntegration(user, integration)` **without awaiting** (fire-and-forget). Log the resolved summary or any unexpected error.
- If the pre-retry blocked count was > 0, redirect to `/dashboard/blocked`. Otherwise keep the current redirect (`/dashboard/auth`). The redirect is based on the pre-retry snapshot intentionally — the user came in expecting to deal with blocked items, so showing them the blocked view (even if some entries vanish a moment later) is the right experience.

The pipeline reference must be passed into `buildOAuthRoutes()` and `buildRoamRoutes()`. Currently they only receive `storage`. Add a `pipeline` parameter to both.

**4. Dashboard blocked view** — `GET /dashboard/blocked`

A new route in `src/dashboard/routes.ts` rendering all of the current user's blocked captures (both `blocked_needs_auth` and `blocked_auth_expired`).

Per-capture row shows: timestamp, raw text, route name, status badge, and a "Retry" button (POST to existing `/retry/:captureId`).

Page header has a "Retry all blocked" button hitting a new `POST /retry/blocked` endpoint that iterates all of the user's blocked captures (oldest first) and calls `retryCapture` on each sequentially. (No need to filter by integration — the user explicitly asked for all of them.)

The page uses an HTML `<meta http-equiv="refresh" content="3">` so the user watches items disappear as retries resolve.

If the list is empty, the page shows a brief "No blocked captures" message.

### Data flow

```
OAuth callback succeeds
  ├─► save tokens
  ├─► installDefaultRoutes (existing behavior)
  ├─► pipeline.retryBlockedForIntegration(user, integration)  [fire-and-forget]
  └─► redirect to /dashboard/blocked  (if blocked.length > 0)
                  /dashboard/auth     (otherwise)
```

```
User visits /dashboard/blocked
  ├─► GET storage.listCapturesNeedingAuth(user)
  ├─► render list with per-capture retry buttons
  └─► page meta-refreshes every 3s while items remain
```

### Error handling

- Individual `retryCapture` failures inside the batch are caught, logged, and the batch continues.
- A capture whose route was deleted while it was blocked gets marked `failed` (existing behavior in `retryCapture`).
- A capture that retries and lands again in `blocked_needs_auth` or `blocked_auth_expired` stays in those states and shows up on the next page refresh.
- The OAuth callback never blocks on retries — a slow integration call cannot break OAuth completion.

### Testing

**Unit (`tests/unit/pipeline.test.ts`)**
- Seeds storage with N blocked captures, mixed across two integrations.
- Calls `retryBlockedForIntegration(user, 'sheets')`.
- Verifies only sheets-routed captures were retried, in oldest-first order.
- Verifies summary counts.
- Verifies a thrown error inside one retry doesn't halt the batch.

**E2E (`tests/e2e/`)**
- Submit a capture routed to sheets while disconnected → assert `blocked_needs_auth`.
- Complete sheets OAuth flow.
- Assert redirect lands on `/dashboard/blocked`.
- Assert capture transitions to `success` (poll the page or capture status).
- Click "Retry" on a still-blocked capture and verify the manual button works.

## File-level changes

- `src/storage/interface.ts` — add `listCapturesBlockedFor` to `StorageInterface`.
- `src/storage/index.ts` — implement in-memory version.
- `src/storage/firestore.ts` — implement Firestore version.
- `src/pipeline/index.ts` — add `retryBlockedForIntegration`.
- `src/server/oauth.ts` — accept `pipeline` in `buildOAuthRoutes`; fire-and-forget retry; conditional redirect.
- `src/server/index.ts` — pass `pipeline` to `buildOAuthRoutes` and `buildRoamRoutes`; add `POST /retry/blocked`.
- `src/integrations/roam/routes.ts` (or wherever `buildRoamRoutes` lives) — same callback wiring as intend/sheets.
- `src/dashboard/routes.ts` — add `GET /dashboard/blocked`.
- `src/dashboard/templates.ts` — add the blocked-view template (or extend an existing one).
- `tests/unit/pipeline.test.ts` — coverage for the new batch method.
- `tests/e2e/` — new spec for the OAuth → auto-retry flow.
