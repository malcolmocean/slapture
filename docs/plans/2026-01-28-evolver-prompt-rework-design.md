# Evolver Prompt Rework - Design Plan

## Goal

Align the Evolver prompt with Phase 4's safety nets (validation layer, draft/live triggers). The evolver is currently too conservative ("default to skip", "don't overfit") when the validation layer now catches bad triggers.

## Key Insight

The Mastermind appears in three contexts:
- **Routing**: Route inputs, create routes with draft triggers
- **Evolution**: Add draft triggers to existing routes after routing
- **Graduation**: Evaluate whether draft triggers should become live

All three share the same principles. The Evolver's job changes from "conservative gatekeeper" to "hypothesis generator."

---

## Design

### 1. Shared Principles Constant

Create `src/mastermind/principles.ts`:

```typescript
export const MASTERMIND_PRINCIPLES = `
You are the Slapture Mastermind - the intelligent routing brain of this capture system.

Your job is to route inputs reliably while minimizing user interruption. The system learns
from user behavior and self-corrects.

## Core Principles

1. **Fit to user habit** - If the user types "liftlog" repeatedly for their weightlifting
   records, that's a pattern worth capturing. Unique shorthands with no other plausible
   meaning are safe triggers.

2. **Draft triggers are cheap hypotheses** - New triggers start as "draft" and get validated
   by a separate sanity-check layer before execution. If wrong, the system self-corrects.
   Be liberal with drafts.

3. **The goal is fewer Mastermind consultations over time** - Every time you're consulted,
   ask: "What trigger would have caught this automatically?" If there's an obvious one, add it.

4. **Validation is your safety net** - A haiku-powered validator sanity-checks draft triggers
   before execution. Bad triggers get caught and flagged for hygiene. You don't need to be
   the last line of defense.

5. **Avoid overly broad triggers** - "log" as a prefix is bad because it matches unrelated
   things. But "liftlog" is fine - it's specific to this user's vocabulary.
`;
```

### 2. Evolver Prompt Rework

**Remove:**
- "CRITICAL: Default to skip"
- "DO NOT overfit"
- "Only evolve when the new input represents a CLEAR, OBVIOUS pattern"
- Defensive framing throughout

**Add:**
- `MASTERMIND_PRINCIPLES` at the top
- New task framing:

```
## Your Task (Evolution Context)

The Mastermind routed this input, but it required LLM judgment. Your job: should there
be a trigger that catches this automatically next time?

If this looks like a user habit or shorthand (a word/phrase they'd likely repeat),
add it as a draft trigger. If it's a one-off phrasing or genuinely ambiguous between
multiple routes, skip.

Draft triggers are cheap - validation tests them. Skipping means future similar inputs
still need Mastermind consultation.
```

**Keep:**
- Regex-only instruction
- Validation failure retry context
- JSON response format (ensure `status: "draft"` for new triggers)

### 3. Mastermind Routing Prompt Update

Minimal changes:
- Prepend `MASTERMIND_PRINCIPLES` to prompt
- Keep existing draft trigger guidance

---

## Files to Change

1. **Create `src/mastermind/principles.ts`** - shared principles constant
2. **Update `src/mastermind/evolver.ts`** - new prompt framing
3. **Update `src/mastermind/index.ts`** - prepend principles

## Testing

- Run `pnpm test:evolver` after changes
- Some "skipped" ratchet cases may become "evolved" - review and update expectations if the new behavior is correct
- The evolver will be more aggressive, which is intentional

---

## Success Criteria

- [x] `MASTERMIND_PRINCIPLES` shared between routing and evolution contexts
- [x] Evolver prompt uses "hypothesis generator" framing, not "conservative gatekeeper"
- [x] New triggers proposed by evolver include `status: "draft"`
- [x] Tests pass (with updated expectations where appropriate)
