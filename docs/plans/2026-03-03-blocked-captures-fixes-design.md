# Blocked Captures Fixes Design

## Problems

1. **Auth status page doesn't show which integration needs auth** — Blocked captures table has no Route column, so "Needs Auth" badge is meaningless without context
2. **Widget doesn't handle blocked status** — Polls until timeout instead of showing blocked state
3. **Blocked captures list is unscoped** — `listCapturesNeedingAuth()` returns ALL users' captures; clicking View scopes to logged-in user → 404
4. **E2E test leaks data** — `intend-oauth.spec.ts` creates captures with no cleanup

## Fixes

### 1. Add Route column to auth page blocked captures table
- Add "Route" column between Input and Status in the blocked captures table at `/dashboard/auth`
- Shows `routeFinal` value (e.g. "intend"), making it clear which integration is blocking

### 2. Widget blocked status handling
- Add `blocked_needs_auth` / `blocked_auth_expired` to widget poll result handler
- Show: "Blocked — needs auth for [route]" with link to `/dashboard/auth`

### 3. Scope all queries to current user
- `listCapturesNeedingAuth(username)` — accept and require username parameter
- `listAllCaptures()` calls from dashboard must pass the auth uid
- The home page stats (`blocked.length`) must also be scoped

### 4. Test cleanup
- Add `afterEach` to `intend-oauth.spec.ts` that deletes created captures
- Existing leaked data: user deletes manually from dashboard

## Files to change
- `src/dashboard/routes.ts` — auth page template, pass username to queries
- `src/widget/index.html` — handle blocked status in poll
- `src/storage/firestore.ts` — `listCapturesNeedingAuth(username)`
- `src/storage/interface.ts` — update interface
- `src/storage/index.ts` — update local storage impl
- `tests/e2e/intend-oauth.spec.ts` — add cleanup
- `tests/unit/storage.test.ts` — update test if needed
