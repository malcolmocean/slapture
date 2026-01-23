# Per-User OAuth Token Storage

## Goal

Support multiple users with separate OAuth credentials, enabling:
- `user:default` - test credentials (qtess/q on intend.do)
- `user:malcolm` - real credentials for actual usage

## Storage Changes

### New directory structure

```
data/
├── users/
│   ├── default/
│   │   └── config.json
│   └── malcolm/
│       └── config.json
├── captures/
│   └── {username}/...     # unchanged
└── config.json            # global config only (no integrations)
```

### Per-user config format

```json
{
  "integrations": {
    "intend": {
      "accessToken": "...",
      "refreshToken": "...",
      "expiresAt": "2026-12-31T23:59:59Z",
      "baseUrl": "https://intend.do"
    }
  }
}
```

### Storage API changes

- `saveIntendTokens(tokens)` → `saveIntendTokens(username, tokens)`
- `getIntendTokens()` → `getIntendTokens(username)`
- `clearIntendTokens()` → `clearIntendTokens(username)`

## OAuth Flow Changes

### Endpoint changes

| Endpoint | Change |
|----------|--------|
| `GET /connect/intend` | Add required `?user=` param |
| `GET /oauth/callback/intend` | Extract user from state param |
| `GET /auth/status/intend` | Add required `?user=` param |
| `POST /disconnect/intend` | Add required `?user=` param |

### State parameter

Encode username in OAuth state param. Decode on callback to route tokens to correct user.

### Validation

Return 400 if `user` param missing - no implicit defaults.

## Executor Changes

IntendExecutor uses capture's username (from storage path) to look up tokens:

```typescript
const tokens = await storage.getIntendTokens(capture.username);
```

No changes needed to retry endpoint - capture already includes username.

## Migration

If global `config.json` has `integrations.intend`, migrate to `data/users/default/config.json` on first load, then remove from global config.
