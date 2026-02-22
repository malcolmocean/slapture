# Authentication Design: Email + Google Sign-in

**Date:** 2026-02-22
**Status:** Approved

## Overview

Add proper user authentication to the cloud-deployed slapture instance using Firebase Auth for identity (email + Google sign-in), Firebase Admin SDK for server-side token verification, and per-user API keys for programmatic/automation access.

Multi-tenant from day one. Single-user is the immediate use case, but all data paths are uid-scoped.

## 1. Authentication Architecture

**Firebase Auth** handles identity for both providers:
- **Email:** Magic link or email+password (configurable in Firebase Console)
- **Google:** OAuth sign-in for identity only — `openid email profile` scopes

**Server-side verification flow:**
1. Client authenticates via Firebase Auth SDK → gets ID token (JWT)
2. Client sends `Authorization: Bearer <firebase-id-token>` on all API requests
3. Hono middleware calls `firebase-admin.auth().verifyIdToken(token)` → extracts `uid`, `email`, `name`
4. If no Bearer token, checks for `X-API-Key` header → looks up key in Firestore
5. Both paths resolve to a user context (`{ uid, email }`) attached to the Hono request context

**User identity mapping:**
- Firebase `uid` is the canonical user ID (replaces freeform `username` string)
- First sign-in creates a `users/{uid}` doc in Firestore with `email`, `displayName`, `createdAt`
- Existing `username` concept maps to a user-chosen display name or slug (defaults to email prefix)
- All per-user data paths use `uid` instead of `username`

## 2. API Keys

**Data model** — `users/{uid}/apiKeys/{keyId}` in Firestore:
```
{
  id: string,
  name: string,           // user-chosen label, e.g. "iOS Shortcut", "CLI script"
  keyHash: string,        // bcrypt hash of the actual key
  prefix: string,         // first chars for display (e.g. "slap_k_a1b2")
  temporary: boolean,     // matches key prefix
  createdAt: timestamp,
  expiresAt: timestamp | null,  // null = never (permanent keys only)
  lastUsedAt: timestamp | null,
  status: 'active' | 'revoked'
}
```

**Key format:**
- Permanent: `slap_k_` + 40 random hex chars
- Temporary: `slap_t_` + 40 random hex chars (must have `expiresAt`)

**Fast lookup:** Top-level `apiKeyIndex/{hashedKey}` → `{ uid, keyId }` collection avoids scanning all users.

**Endpoints:**
- `POST /api/keys` — create key (returns full key once)
- `GET /api/keys` — list keys (name, prefix, created, last used, expiry — never full key)
- `DELETE /api/keys/:keyId` — revoke key

## 3. Pages & Route Structure

**Public (no auth):**
- `GET /` — Landing page (minimal, explains what slapture is)
- `GET /login` — Sign-in page with FirebaseUI (email + Google buttons). Note about Google test mode.
- `GET /signup` — Hidden but functional registration page (same FirebaseUI, non-linked URL)

**Authenticated (Firebase token or API key):**
- `POST /capture` — Main capture endpoint
- `GET /captures`, `GET /captures/blocked`, `GET /status/:captureId`, `POST /retry/:captureId`
- `GET /routes` — List routes
- `GET /dashboard/*` — Dashboard UI
- `GET /widget` — Capture widget
- `POST /api/keys`, `GET /api/keys`, `DELETE /api/keys/:keyId` — Key management
- `/connect/*`, `/oauth/callback/*`, `/auth/status/*`, `/disconnect/*` — Integration OAuth

## 4. Incremental Google Scopes

**Sign-in scopes:** Only `openid email profile` — identity only.

**Integration connection (e.g. Google Sheets):**
1. User goes to dashboard → integrations → "Connect Google Sheets"
2. Separate Google OAuth flow requests only the `spreadsheets` scope
3. Uses adapted OAuth machinery from `src/server/oauth.ts`
4. Integration tokens stored at `users/{uid}/integrations/sheets`
5. Firebase Auth identity unaffected

**Key distinction:** Firebase Auth = who you are. Integration OAuth = what you've granted access to. Completely separate token flows.

**Future integrations:** Same pattern per service. Each stored at `users/{uid}/integrations/{service}`. Connect/disconnect independently. Dashboard shows connection status.

## 5. Multi-tenancy & Data Isolation

**User document** — `users/{uid}`:
```
{
  uid: string,
  email: string,
  displayName: string,
  createdAt: timestamp
}
```

**Data scoping (all uid-scoped):**
- Captures: `captures/{uid}/items/{captureId}`
- Routes: `users/{uid}/routes/{routeId}` (subcollection, per-user)
- Config: `users/{uid}/config`
- API keys: `users/{uid}/apiKeys/{keyId}`
- Integration tokens: `users/{uid}/integrations/{service}`
- Hygiene signals, evolver test cases, trigger reviews: per-user subcollections

**No migration needed:** Cloud Firestore backend starts fresh with uid-scoped paths. Local dev keeps old system.

## 6. Testing Strategy

**Unit tests:**
- Auth middleware: mock Firebase Admin SDK, test token verification, API key lookup, expired key rejection, 401s
- API key management: creation, listing, revocation, expiry
- User creation on first sign-in

**E2E tests:**
- Firebase Auth Emulator for testing without real Firebase
- Full flow: sign up → get token → authenticated capture → verify user scoping
- API key flow: create → use → verify
- Negative: expired/revoked key → 401

**Firebase Emulator:** `FIREBASE_AUTH_EMULATOR_HOST` env var tells admin SDK to use emulator. No real accounts needed.

## Dependencies

- `firebase-admin` — server-side token verification, user management
- `firebase` (client SDK) — used in frontend pages for sign-in
- `firebaseui` — pre-built sign-in UI component
- `bcrypt` (or `bcryptjs`) — API key hashing
