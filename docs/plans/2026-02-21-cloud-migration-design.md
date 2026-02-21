# Cloud Migration Design: Hono + Firestore + Cloud Run

## Goal

Move slapture from a local-only Fastify/filesystem app to a cloud-deployable Hono/Firestore app on Cloud Run, while keeping local dev identical (`pnpm dev`, `pnpm test`).

## Sequence

Three steps, each independently verifiable:

1. **Fastify → Hono** (web framework swap)
2. **Filesystem → Firestore** (storage backend swap)
3. **Cloud Run deployment** (Dockerfile + deploy config)

## Step 1: Hono Migration

**Dependencies changed:**
- Remove: `fastify`, `@fastify/formbody`
- Add: `hono`, `@hono/node-server`

**Files changed:**
- `src/server/index.ts` — Rewrite with Hono API. Same routes, same logic.
- `src/server/oauth.ts` — Fastify route signatures → Hono route signatures.
- `src/dashboard/routes.ts` — Register on Hono app instead of FastifyInstance.
- `src/index.ts` — Use `@hono/node-server` `serve()` instead of `server.listen()`.
- `tests/unit/server.test.ts` — Replace `server.inject()` with `app.request()`.

**Files unchanged:** Storage, pipeline, dispatcher, parser, executor, types, all non-server tests.

**Verification:** `pnpm test` + `pnpm test:e2e`. Same behavior, different framework.

## Step 2: Firestore Storage

**New file:** `src/storage/firestore.ts` — `FirestoreStorage` class.

**New dependency:** `@google-cloud/firestore`

**Interface extraction:** Both `Storage` and `FirestoreStorage` satisfy a shared `StorageInterface`.

**Firestore collections:**
- `captures/{username}/items/{timestamp_uuid}`
- `routes/{id}`
- `executions/{captureId}`
- `config/main`
- `users/{username}/config`
- `users/{username}/notes/integrations/{id}`
- `users/{username}/notes/destinations/{id}`
- `evolver-tests/{id}`
- `trigger-reviews/{id}`
- `hygiene-signals/all`
- `inbox/entries`

**`fs` route filtering:** When `STORAGE_BACKEND=firestore`, `listRoutes()` excludes `destinationType: 'fs'` routes from dispatch. They remain in storage but are invisible to the pipeline.

**Switching:** `src/index.ts` reads `STORAGE_BACKEND` env var. Default is `local` (filesystem). Set to `firestore` for cloud.

**Local dev:** Unchanged. `STORAGE_BACKEND` defaults to `local`.

## Step 3: Cloud Run Deployment

**New files:**
- `Dockerfile` — Node image, pnpm install, build, run.
- `.dockerignore` — Exclude data/, filestore/, .env, node_modules.

**Cloud Run env vars:**
- `STORAGE_BACKEND=firestore`
- `ANTHROPIC_API_KEY` (secret)
- `INTEND_CLIENT_ID`, `INTEND_CLIENT_SECRET` (if OAuth needed)
- `CALLBACK_BASE_URL=https://slapture.com`
- `PORT` is set automatically by Cloud Run

**Auth:** Ambient GCP credentials on Cloud Run — no service account key file needed in production.

**Widget HTML:** Baked into container image, served from filesystem. Works as-is.

**DNS:** See HUMAN.md for slapture.com setup steps.

## What doesn't change

- Pipeline logic, dispatcher, parser, executor
- LLM calls (Anthropic SDK)
- OAuth flow logic (just callback URL changes)
- E2E test structure (Playwright hits HTTP either way)
- Local dev workflow (`pnpm dev` / `pnpm test`)
