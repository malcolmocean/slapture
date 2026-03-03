# Firebase Auth Migration + Intend Integration Fix

**Date**: 2026-02-22
**Status**: Approved

## Problem

The dashboard and OAuth routes still use legacy `?token=` query params throughout, even though prod uses Firebase auth with session cookies. This creates broken flows when trying to use Intend OAuth integration in production — the OAuth routes expect `?user=` query params instead of reading the authenticated user from the session.

## Decision

Rip out legacy token-based auth entirely. Always use Firebase auth. Test against prod Firestore with a dedicated test user.

## Changes

### 1. Remove Legacy Token Auth
- `src/server/index.ts`: Remove `useFirebaseAuth` parameter from `buildServer()`. Remove the legacy token middleware `else` branch. Always use Firebase auth middleware.
- `src/index.ts`: Remove conditional that sets `useFirebaseAuth` based on `STORAGE_BACKEND`.

### 2. Strip `?token=` from Dashboard
- `src/dashboard/templates.ts`: Remove `token` parameter from `layout()`. Nav links use plain paths.
- `src/dashboard/routes.ts`: Remove all `c.req.query('token')` reads. Remove `?token=${token}` from every link, form action, and redirect.

### 3. Fix OAuth Routes to Use Authenticated User
- `src/server/oauth.ts`: `/connect/intend`, `/disconnect/intend`, `/auth/status/intend` — read user from `c.get('auth').uid` instead of `?user=` query param.
- `src/dashboard/routes.ts` `/dashboard/auth`: Use `c.get('auth').uid` instead of hardcoded `'default'`.

### 4. Test Infrastructure
- Create test user `qtess@slapture.com` (password `q`) in prod Firebase.
- E2E tests use API key auth for API calls, browser login for dashboard/OAuth flows.
- Test Intend OAuth flow end-to-end: login to slapture, initiate OAuth, login to intend.do as qtess/q, authorize, send intention-formatted captures, verify success.

### 5. Not Changing
- Storage backends (Firestore/local filesystem)
- API key auth system
- Capture pipeline / routing logic
- The widget
