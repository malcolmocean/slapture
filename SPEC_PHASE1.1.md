# Slapture: Phase 1.1 - Dynamic File Logging & Personal Shorthands

## Overview

Phase 1.1 extends the core routing system to better handle dynamic file targets and personal shorthand commands. This addresses a gap in Phase 1 where the Mastermind creates routes correctly but they fail due to path resolution issues, and where multi-word route hints aren't recognized.

## Problem Statement

### Issue 1: Dynamic File Paths

When a user says:
```
log "you put a ring on the circular thing" to gwen_memories.csv with today's date
```

The Mastermind correctly:
1. Recognizes this needs a new route
2. Creates a "log" route with a transformScript that extracts the filename from the payload
3. Attempts to execute

But execution fails because:
- The transformScript uses `fs.appendFileSync(filename, entry)` where `filename` is a relative path (`gwen_memories.csv`)
- The sandboxed fs resolves relative paths against the current working directory, not the user's filestore directory
- Path validation fails: "access denied outside user directory"

**Fix**: Sandboxed fs should resolve relative paths within the user directory.

### Issue 2: Multi-Word Route Hints

After the "log" route exists, the user wants to use a personal shorthand:
```
gwen memory: "you said milk! for the first time"
```

Currently the parser only recognizes single-word route hints (`word:`). Multi-word hints like `gwen memory:` aren't matched, so this goes to Mastermind unnecessarily.

**Fix**: Extend parser to recognize multi-word route hints, and have Mastermind add appropriate triggers when creating routes.

## New Features

### Dynamic Destination Files

Routes can now specify `destinationConfig.filePath: "dynamic"` to indicate that the actual file path is determined at execution time by the transformScript. The transformScript extracts the target file from the payload and writes to it.

The sandboxed fs now resolves relative paths within the user's filestore directory:
```typescript
// Before (broken)
const resolved = path.resolve(p);  // Resolves to CWD

// After (fixed)
const resolved = path.isAbsolute(p) ? p : path.resolve(userDir, p);
```

### Multi-Word Route Hints

Parser is extended to recognize multi-word route hints:
```
gwen memory: content     -> explicitRoute: "gwen memory", payload: "content"
project notes: content   -> explicitRoute: "project notes", payload: "content"
```

Routes can have triggers that match these multi-word patterns:
```typescript
{
  type: 'prefix',
  pattern: 'gwen memory',  // Multi-word
  priority: 10
}
```

### Smart Shorthand Generation

When Mastermind creates a route for a "log X to Y" command, it should also:
1. Recognize the target file name (e.g., `gwen_memories.csv`)
2. Infer a natural shorthand (e.g., "gwen memory:")
3. Add that as an additional trigger

This enables the flow:
1. User: `log "first word" to gwen_memories.csv with today's date`
2. Mastermind creates route with triggers: `["log", "gwen memory"]`
3. User: `gwen memory: "second word!"`
4. Dispatcher matches existing route, no Mastermind needed

## Test Examples

### Example Set F: Dynamic File Logging

```
Input: log "you put a ring on the circular thing" to gwen_memories.csv with today's date
Expected:
  - Parser: explicitRoute=null, payload="log \"you put a ring...\" to gwen_memories.csv..."
  - Dispatcher: no match -> Mastermind
  - Mastermind: creates "log" route with dynamic file handling
  - Execution: creates filestore/{username}/gwen_memories.csv with entry
    "2026-01-22: you put a ring on the circular thing"
  - Status: success
```

```
Input: log "another memory" to gwen_memories.csv with today's date
Expected:
  - Dispatcher: matches "log" route (prefix trigger)
  - Execution: appends to filestore/{username}/gwen_memories.csv
  - Status: success
```

### Example Set G: Multi-Word Route Hints

```
Setup: Route exists with triggers ["log", "gwen memory"]

Input: gwen memory: "you said milk! for the first time"
Expected:
  - Parser: explicitRoute="gwen memory", payload="\"you said milk!...\""
  - Dispatcher: matches route by prefix "gwen memory"
  - Execution: appends to gwen_memories.csv with timestamp
  - Status: success
```

```
Input: baby milestones: "first steps today!"
Expected:
  - Parser: explicitRoute="baby milestones", payload="\"first steps today!\""
  - Dispatcher: no match -> Mastermind
  - Mastermind: creates "baby-milestones" route with:
    - triggers: ["baby milestones"]
    - destinationConfig: { filePath: "baby_milestones.csv" }
  - Execution: creates/appends to baby_milestones.csv
  - Status: success
```

### Example Set H: CSV with Timestamps

```
Setup: weightlog route exists

Input: weight 88.2kg
Expected:
  - CSV row: "2026-01-22,88.2,kg"
  - Verify CSV has header if first entry
```

```
Input: gwen memory: "walked to the park together"
Expected:
  - CSV row: "2026-01-22,walked to the park together"
  - Date from system, not extracted from payload
```

### Example Set I: Error Handling

```
Input: log "test" to ../escape.txt with today's date
Expected:
  - Mastermind creates route
  - Execution: path validation fails (escape attempt)
  - Status: failed
  - Error logged in execution trace
```

## Implementation Notes

### Parser Changes

```typescript
// Extended regex for multi-word route hints
const colonMatch = trimmed.match(/^([a-zA-Z][\w\s-]*?):\s+(.+)$/s);
```

The route name can now contain spaces but must start with a letter.

### Mastermind Prompt Updates

Add to the Mastermind prompt:
```
When creating routes for "log X to Y" patterns:
1. Extract the target filename (e.g., "gwen_memories.csv")
2. Create a natural shorthand trigger from the filename (e.g., "gwen memory")
3. Include both "log" prefix and the shorthand in triggers

For transformScript with dynamic files:
- Use relative filenames - they're resolved within the user's filestore
- Extract filename from payload when needed
- Include timestamp handling
```

### Dispatcher Changes

Dispatcher needs to match multi-word prefixes:
```typescript
// For prefix triggers, check if payload starts with pattern (case-insensitive)
if (trigger.type === 'prefix') {
  const payloadLower = parsed.payload.toLowerCase();
  const patternLower = trigger.pattern.toLowerCase();
  if (payloadLower.startsWith(patternLower)) {
    // Match
  }
}
```

## Success Criteria

Phase 1.1 is complete when:

1. [x] Sandboxed fs resolves relative paths within user directory
2. [ ] Parser recognizes multi-word route hints (`gwen memory: content`)
3. [ ] Dispatcher matches multi-word prefix triggers
4. [ ] Mastermind generates shorthand triggers for log-to-file routes
5. [ ] Example Sets F-I pass as tests
6. [ ] `log "X" to Y.csv with today's date` creates file and writes correctly
7. [ ] Subsequent `Y hint: "Z"` commands use existing route

## Migration Notes

No breaking changes to existing routes. The path resolution fix is backwards-compatible - previously this would fail, now it works.
