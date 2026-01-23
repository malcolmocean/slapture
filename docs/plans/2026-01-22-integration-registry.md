# Integration Registry & Notes

**Goal:** Give Mastermind context about available integrations so it makes smarter routing decisions. Allow users to leave notes on integrations and destinations.

## Concepts

- **Integration**: API/service (intend.do, Google Sheets, filesystem, notes)
- **Destination**: Specific place within an integration (a spreadsheet, a file, a user's intend account)
- **Route**: Matching logic that connects inputs → destinations

## Tasks

### Task 1: Integration type and registry

**Files:** `src/integrations/registry.ts` (new), `src/types.ts`

Add Integration type:
```typescript
interface Integration {
  id: string;                    // 'intend', 'fs', 'notes'
  name: string;                  // 'intend.do', 'Local Files', 'Notes'
  purpose: string;               // "Track daily intentions, todos, goals"
  authType: 'oauth' | 'api-key' | 'none';
}
```

Create registry with initial integrations:
- `intend`: intend.do, "Track daily intentions, todos, and goals", oauth
- `fs`: Local Files, "Append data to local CSV, JSON, or text files", none
- `notes`: Notes, "Save notes about integrations and destinations", none

Add function `getIntegrationsWithStatus(storage, username)` that returns integrations enriched with current auth status ('connected' | 'expired' | 'not-connected').

### Task 2: Note storage methods

**Files:** `src/storage/index.ts`

Add methods:
- `getIntegrationNote(username, integrationId): Promise<string | null>`
- `saveIntegrationNote(username, integrationId, content): Promise<void>`
- `getDestinationNote(username, destinationId): Promise<string | null>`
- `saveDestinationNote(username, destinationId, content): Promise<void>`

Storage locations (plaintext):
- `data/users/{username}/notes/integrations/{integrationId}.txt`
- `data/users/{username}/notes/destinations/{destinationId}.txt`

For destination IDs, sanitize to be filesystem-safe (replace `/` with `_`, etc).

### Task 3: Notes integration executor

**Files:** `src/routes/notes-executor.ts` (new)

Executor for the `notes` integration. Handles:
- `destinationType: 'notes'`
- `destinationConfig: { target: 'integration' | 'destination', id: string }`

When executed:
- Parse the payload as the note content
- Save to appropriate location via storage methods
- Support append (default) or overwrite (if payload starts with "REPLACE:" or similar)

### Task 4: Update Mastermind prompt with integration context

**Files:** `src/mastermind/index.ts`

Inject into Mastermind prompt:
```
Available Integrations:
- intend.do: Track daily intentions and goals [connected]
- Local Files: Append to CSV/JSON/txt files [no auth needed]
- Notes: Save notes about integrations and destinations [no auth needed]

Your notes on integrations:
- intend.do: "I phrase these as verbs, present tense"

When creating routes, consider which integration best fits the user's intent.
The "notes" integration lets users save context about other integrations/destinations.
```

Also inject destination notes when showing existing routes/destinations.

### Task 5: Update Route type for notes destination

**Files:** `src/types.ts`

Extend destinationType and destinationConfig:
```typescript
destinationType: 'fs' | 'intend' | 'notes';
destinationConfig:
  | { filePath: string }           // fs
  | { baseUrl: string }            // intend
  | { target: 'integration' | 'destination', id: string };  // notes
```

### Task 6: Wire up notes executor in pipeline

**Files:** `src/pipeline/index.ts` or `src/routes/executor.ts`

When `destinationType === 'notes'`, use NotesExecutor.

### Task 7: Delete conflicting intentions route

The "intentions" route that writes to CSV is stealing captures from intend.do. Delete it so Mastermind routes "intention" inputs correctly.

**Files:** Data cleanup via API or direct storage call.

### Task 8: Tests

- Unit tests for registry functions
- Unit tests for note storage methods
- Unit tests for notes executor
- Integration test: Mastermind sees integration context
- E2E test: "note on intend: I use present tense verbs" saves correctly
