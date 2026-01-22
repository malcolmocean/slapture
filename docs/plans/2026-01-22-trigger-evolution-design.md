# Trigger & Transform Evolution Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When Mastermind routes an input to an existing route (because it didn't auto-match), evolve that route's triggers/transforms to handle the variation, then validate the change doesn't break existing matches.

**Architecture:** New "Evolver" LLM prompt within the mastermind system. Fires after Mastermind says "route to existing". Modifies triggers and/or transforms, then replays all captures to validate. Keeps route version history.

**Tech Stack:** TypeScript, Anthropic API (claude-sonnet), existing route/capture storage

---

## When It Fires

```
Input arrives
  → Parser
  → Dispatcher: no match
  → Mastermind: "route to route-xyz"
  → Evolver fires (this feature)
  → Execute on route-xyz
```

The Evolver only fires when Mastermind routes to an existing route. If Mastermind creates a new route, clarifies, or inboxes - no evolution needed.

Future: Validation layer can also trigger Evolver when it detects anomalies (e.g., 194.1 when expecting kg).

---

## Evolver LLM Prompt

### Input Context

The Evolver sees:

1. **The new input** that triggered evolution
2. **Current route state:**
   - Triggers (numbered for reference)
   - Transform script
   - Recent items (last N successful matches)
3. **Why Mastermind matched it** - the reasoning from Mastermind's response

On retry (if validation fails), also include:
- The validation failure details
- Other routes' triggers (to avoid collisions)

### Response Format

Sectioned output - only include sections being modified:

```json
{
  "triggers": [
    { "type": "keyword", "pattern": "gwen memory", "priority": 5 },
    { "type": "regex", "pattern": "^gwen ?memor(y|ies)$", "priority": 10 }
  ],
  "transform": "const date = timestamp.split('T')[0]; ...",
  "reasoning": "Added regex to handle singular/plural variation"
}
```

If only modifying triggers:
```json
{
  "triggers": [...],
  "reasoning": "..."
}
```

If only modifying transform:
```json
{
  "transform": "...",
  "reasoning": "..."
}
```

---

## Validation

After Evolver proposes changes, validate by replaying ALL captures:

### Test 1: This route's captures still match

For every capture in `data/captures/` where `routeFinal === this route`:
- Run new triggers against the capture's raw input
- Must still match

### Test 2: Other routes' captures don't match

For every capture in `data/captures/` where `routeFinal !== this route`:
- Run new triggers against the capture's raw input
- Must NOT match (would be a collision)

### On Validation Failure

1. First failure: Retry with failure context (which inputs failed, why)
2. Second failure: Add other routes' triggers to context
3. Third failure: Flag for user, don't apply changes

### Applying Changes

If validation passes:
1. Create new route version (preserve history)
2. Update route file with new triggers/transform
3. Log the evolution event

---

## Route Versioning

Routes gain a `versions` array:

```json
{
  "id": "route-xyz",
  "name": "gwen_memories",
  "triggers": [...],
  "transform": "...",
  "versions": [
    {
      "version": 1,
      "timestamp": "2026-01-22T05:20:44.853Z",
      "triggers": [...],
      "transform": "...",
      "reason": "Initial creation by mastermind"
    },
    {
      "version": 2,
      "timestamp": "2026-01-22T06:15:00.000Z",
      "triggers": [...],
      "transform": "...",
      "reason": "Evolved to handle 'gwen memories' plural variant",
      "evolvedFrom": "gwen memories: test input"
    }
  ]
}
```

Current state is always at top level. Versions array is append-only history.

---

## File Structure

```
src/mastermind/
  index.ts          # Main Mastermind class (existing)
  evolver.ts        # Evolver logic (new)
  prompts.ts        # Shared prompt utilities (new, extracted)
```

Or if simpler, extend `index.ts` with Evolver methods. Will decide during implementation.

---

## Example Flow

### Input
```
gwen memories: your hair is curlier than artemis's
```

### Current Route State
```
name: gwen_memories
triggers:
  0. keyword: "gwen memory"
  1. prefix: "log"
transform: const date = timestamp.split('T')[0]; ...
recentItems:
  - "gwen memory: you said milk for the first time"
  - "log \"test memory\" to gwen_memories.csv with today's date"
```

### Mastermind Response
```json
{
  "action": "route",
  "routeId": "route-xyz",
  "reason": "User said 'gwen memories' (plural), likely meant gwen_memories route"
}
```

### Evolver Fires

Prompt includes current triggers, transform, recentItems, new input, Mastermind's reasoning.

### Evolver Response
```json
{
  "triggers": [
    { "type": "regex", "pattern": "^gwen memor(y|ies)$", "priority": 10 },
    { "type": "prefix", "pattern": "log", "priority": 5 }
  ],
  "reasoning": "Replaced keyword trigger with regex to handle singular/plural"
}
```

### Validation

Replay all captures:
- `gwen memory: you said milk...` → matches new regex ✓
- `log "test memory" to gwen...` → matches prefix ✓
- `weight 88.2kg` → doesn't match (good, different route) ✓

### Apply

Update route with new triggers, add version to history.

---

## Edge Cases

### Evolver can't find a pattern
If the variation is too weird (typo, completely different phrasing), Evolver should respond:
```json
{
  "action": "skip",
  "reasoning": "Input 'gwn memry' appears to be a typo, not a pattern worth capturing"
}
```

Route executes anyway (Mastermind already approved), but no evolution occurs.

### Transform needs modification
```
Input: weight 194.1
Current transform: just appends value to CSV
Mastermind: routes to weight route, notes "possibly lbs not kg"
```

Evolver response:
```json
{
  "transform": "let val = parseFloat(payload.match(/[\\d.]+/)[0]); if (val > 140) val = val / 2.205; fs.appendFileSync(filePath, timestamp.split('T')[0] + ',' + val.toFixed(1) + '\\n');",
  "reasoning": "Added unit conversion for values >140 (likely lbs)"
}
```

### Collision detected in validation

First attempt creates trigger that also matches another route's inputs.

Retry with context:
```
Validation failed: new trigger "^weight" also matches these inputs from other routes:
- "weight lifting schedule" (route: fitness_schedule)
- "weight loss tips" (route: health_notes)

Other routes' triggers for reference:
- fitness_schedule: keyword "schedule", regex "^(workout|weight lifting)"
- health_notes: keyword "health", keyword "tips"
```

Evolver adjusts to be more specific.

---

## Success Criteria

1. [ ] Evolver fires when Mastermind routes to existing
2. [ ] Evolver can modify triggers only, transform only, or both
3. [ ] Validation replays all captures
4. [ ] Up to 3 retries with context on failure
5. [ ] Route versions preserved
6. [ ] `gwen memories:` auto-evolves to match alongside `gwen memory:`

---

## Not In Scope (Future)

- Reusable transform library with parameters
- Validation layer triggering evolution (e.g., anomaly detection)
- User approval flow before applying changes
- Rollback mechanism
