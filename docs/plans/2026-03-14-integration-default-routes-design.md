# Integration Default Routes

## Problem

When a user connects intend.do, they expect captures in intend's intention format (`1) do laundry`, `&) random task`) to route there automatically. Currently nothing creates this route — the user has to wait for the mastermind to learn, or manually create it. This is friction for a known, well-defined format.

More generally: some integrations have obvious default routes that should exist as soon as the integration is connected. We need a small abstraction for this.

## Design

### Default route definitions on integrations

Each integration can optionally declare default routes. Most won't (sheets, roam, fs, notes are unstructured media, not opinionated destinations). But intend has a specific format, and future integrations may too.

```typescript
// New interface
interface DefaultRouteTemplate {
  key: string;              // Stable identifier, e.g. 'intend-format'
  name: string;             // Route name, e.g. 'intend'
  description: string;
  triggers: Array<{ pattern: string; priority: number }>;
  destinationType: Route['destinationType'];
  destinationConfig: Route['destinationConfig'];
  transformScript: string | null;
}

// Extended Integration type
interface Integration {
  id: string;
  name: string;
  purpose: string;
  authType: 'oauth' | 'api-key' | 'none';
  defaultRoutes?: DefaultRouteTemplate[];  // NEW — optional
}
```

### Intend's default route

One default route with a regex trigger matching the intend intention format:

```typescript
{
  key: 'intend-format',
  name: 'intend',
  description: 'Intentions in intend.do format (e.g. "1) do laundry", "&) random task")',
  triggers: [{
    // Matches the intend intention format regex:
    // optional extras, goal code(s), optional extras, delimiter, space, text
    pattern: '^[^\\d\\sA-Za-z)]{0,3}(?:(?:\\d|[A-Z]{2})(?:,(?:\\d|[A-Z]{2}))*)?[^\\d\\sA-Z)]{0,3}(?:\\)+|//)\\s+.+',
    priority: 10,
  }],
  destinationType: 'intend',
  destinationConfig: { baseUrl: '' },  // intend executor gets baseUrl from tokens, not config
  transformScript: null,
}
```

The trigger starts as `live` (not `draft`) — this is a known format, not a hypothesis. Templates use simplified trigger shapes (`pattern` + `priority` only); the `createTrigger()` helper expands them with defaults (`type: 'regex'`, `status: 'live'`, `fireCount: 0`, stats) at install time.

Note: the regex intentionally uses `.+` (not `.*`) for the trailing text — an empty intention is not useful and shouldn't match. The pattern should be compiled without the `u` flag, matching how the dispatcher compiles trigger patterns (it uses `new RegExp(pattern, 'i')` — case-insensitive but not unicode-aware).

### Tagging routes with their origin

Routes created from defaults get tagged so we can detect their state later:

```typescript
// New optional field on Route
interface Route {
  // ...existing fields...
  defaultSource?: {
    integrationId: string;  // 'intend'
    defaultKey: string;     // 'intend-format'
    templateHash: string;   // Hash of template at install time (for detecting modifications)
  };
}
```

`createdBy` gets a new value: `'integration'`. This lets the UI show provenance ("Added by intend.do") without special-casing.

### State detection

For each default route template, compute state by checking existing routes:

- **active**: A route with matching `defaultSource` exists, and its current hash matches `defaultSource.templateHash`.
- **modified**: A route with matching `defaultSource` exists, but its current hash differs from `defaultSource.templateHash` (user edited triggers, config, etc.).
- **deleted**: No route with matching `defaultSource` exists.

State is computed, not stored. The hash covers `triggers` (pattern + priority only) and `destinationConfig`, computed via `JSON.stringify` + simple hash. The `templateHash` is stored in `defaultSource` at install time so we compare against the original, not the current template (which may have changed in a code update).

```typescript
type DefaultRouteState = 'active' | 'modified' | 'deleted';

interface DefaultRouteStatus {
  template: DefaultRouteTemplate;
  state: DefaultRouteState;
  existingRouteId?: string;  // If active or modified
}
```

### Install on auth

When OAuth completes successfully (right after `storage.saveIntendTokens()` in `oauth.ts`), call a generic function:

```typescript
async function installDefaultRoutes(
  integrationId: string,
  storage: StorageInterface
): Promise<number>  // Returns count of routes created
```

This function:
1. Looks up the integration's `defaultRoutes` array.
2. For each template, checks if a route with that `defaultSource` already exists (by querying routes).
3. If not, creates the route with a generated UUID for `id`, `createdBy: 'integration'`, and the `defaultSource` tag (including `templateHash`).
4. Returns the count of newly created routes.

If the user previously deleted the default route and re-auths, it gets re-installed. This is intentional — re-connecting is a signal you want the integration working.

The OAuth callback passes the count to the dashboard redirect: `/dashboard/auth?defaultRoutes=1`. The dashboard shows a toast/banner: "1 route auto-added".

### Dashboard UI for default route management

On the auth status page, integrations that have default routes get an extra section (only when connected). For each default route template, show its state with the appropriate action:

| State | Display | Action |
|-------|---------|--------|
| active | "intend format route" with green indicator | No action (or disabled button) |
| modified | "intend format route (customized)" | "Reset to default" button |
| deleted | "intend format route (removed)" | "Re-add" button |

"Reset to default" shows a confirmation dialog before overwriting.

### Endpoints

- `POST /dashboard/default-routes/:integrationId/:key/restore` — Re-adds or resets a default route. Handles both "deleted" (create new) and "modified" (overwrite) states. Redirects back to `/dashboard/auth`.

## Not in scope

- Default routes for sheets, roam, fs, notes (they don't have well-defined input formats)
- Automatic deletion of default routes on disconnect (the route may still be useful as a template)
- Versioning of default route templates (if the template changes in a code update, existing routes keep their current config — user can "reset to default" to pick up changes)

## Files to change

1. **`src/types.ts`** — Add `defaultSource` to `Route`, add `'integration'` to `createdBy`, add `DefaultRouteTemplate` interface, add `defaultRoutes` to `Integration`
2. **`src/integrations/registry.ts`** — Add `defaultRoutes` to intend's integration definition
3. **New: `src/integrations/default-routes.ts`** — `installDefaultRoutes()`, `getDefaultRouteStatuses()`, hash comparison logic
4. **`src/server/oauth.ts`** — Call `installDefaultRoutes` after token save in both intend and sheets OAuth callbacks, pass count to redirect. (Sheets has no default routes today, but the hook should be there for consistency.)
5. **`src/dashboard/routes.ts`** — Show default route statuses on auth page, handle `defaultRoutes` query param toast, add restore endpoint
6. **`tests/`** — Unit tests for install logic, state detection, hash comparison
