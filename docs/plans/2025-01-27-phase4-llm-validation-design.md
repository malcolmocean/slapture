# Phase 4: LLM Validation Layer - Design Plan

## Goal

Add semantic intelligence at the route level so that:
1. Pattern-matched routes can reject obviously wrong items before execution
2. Routes self-maintain through hygiene checks triggered by signals
3. New routes graduate from "soft" (hypothesis) to "hard" (auto-execute) based on evidence

---

## Key Design Decisions

### 1. Kill Prefix Routes

Prefix routes are a foot-gun. They encourage overly broad matching (e.g., `log` catching everything starting with "log").

**Decision:** Hard cut. Remove prefix trigger support entirely. Existing routes with prefix triggers will fail to match - the system self-repairs when new inputs arrive and trigger route creation/modification.

Regex is strictly more expressive. What was `prefix: "log"` can be `regex: /^log\b/` if truly needed, but the Mastermind should be more thoughtful about creating broad matchers.

### 2. Soft Routes (Hypothesis → Graduation)

The Mastermind shouldn't auto-create routes on first novel input. Instead:

```
Novel input arrives
        ↓
Mastermind creates SOFT route (hypothesis)
        ↓
Soft route FIRES on future matches, but doesn't auto-execute
        ↓
Input goes to Mastermind with context:
  - "Draft route matched: /gwen\s?memor(y|ies)/ → gwen_memories.csv"
  - "This is firing #3"
  - "Previous fires: [input1], [input2]"
        ↓
Mastermind decides:
  - "3 fires, consistent format → GRADUATE to hard route"
  - OR "2 fires but inputs differ → keep soft, route manually"
```

The soft route accumulates evidence. The Mastermind sees the hypothesis being tested and graduates it when confident (typically 2-4 consistent fires).

### 3. Routes Can Have Zero Matchers

A route is a *destination* that the Mastermind knows about. Matchers are optional.

```
Route = Destination + optional Matchers

Matchers trigger automatic routing (when confident)
No matchers = Mastermind always decides
Soft matchers = hypothesis being tested
Hard matchers = graduated, auto-execute
```

Some destinations:
- Only get explicitly invoked ("send this to X")
- Never develop a reliable pattern (too varied in how they're expressed)
- Are used by Mastermind judgment, not regex

### 4. Named Confidence Levels

LLMs are bad at numeric confidence (0-1 or 0-100). Use named levels with clear meanings:

| Level | Meaning | Action |
|-------|---------|--------|
| **certain** | Unambiguously same intent as items here | Execute |
| **confident** | Very likely same intent, minor surface differences | Execute |
| **plausible** | Could belong here, but something's slightly off | Execute, flag for review |
| **unsure** | Genuinely ambiguous - could go either way | Mastermind decides |
| **doubtful** | Probably doesn't belong, but I see why it matched | Mastermind decides + hygiene signal |
| **reject** | Definitely wrong route, matcher is misfiring | Mastermind + trigger route hygiene |

Example for a weightlog route:
```
certain:   "weight 88.1kg"           (exact format match)
confident: "88.3 kg"                 (minor format variation)
plausible: "weight 192.9"            (different unit, same intent?)
unsure:    "baby weight 10.3kg"      (might be separate tracking)
doubtful:  "weight of the package: 2kg"  (different domain)
reject:    "weight of evidence suggests..." (not a measurement)
```

### 5. Validation Context (What LLM Sees)

When validating an input, the LLM receives:

| Context | Purpose |
|---------|---------|
| **Route description** | Human-readable intent ("Log memories about Gwen with date") |
| **Matcher that fired** | Which regex triggered this - LLM can assess if it's too broad |
| **Recent successes** (5-10) | "Here's what belongs here" |
| **Negative examples** | "Here's what got rejected/corrected" |
| **Edge cases that passed** | Items that were `plausible`/`unsure` but ultimately belonged |

Showing the matcher is critical - it lets the LLM reason about route hygiene ("this matched `/^log/` which seems too broad for this route's intent").

### 6. Route Hygiene is Signal-Based

No timers or polling. Route review triggers on *signal*:

| Signal | What happens |
|--------|--------------|
| Validation returns `doubtful` or `reject` | "This input didn't belong - is the route misconfigured?" |
| Soft route fires | "Evaluating whether to graduate this matcher" |
| User correction | "User said this was wrong - what needs fixing?" |
| Mastermind routes manually to a route with matchers | "Why didn't matchers catch this? Should they be broadened?" |

The system is event-driven. An old unused route isn't a problem - if nothing's going there, nothing's being misrouted.

### 7. Auto-Detection of Redundant Matchers

Programmatic checks that run on hygiene signal:

| Detection | Method |
|-----------|--------|
| Matcher never fires | Exists but hasn't matched anything in N captures → removal candidate |
| Matcher only fires alongside another | If A only fires with B, and B is more specific, A may be redundant |
| All recent matches from one matcher | Route has 3 matchers but 100% of last 20 via regex X → others stale |
| Validation failures from one matcher | Matcher X fires but validation is `doubtful`/`reject` → too broad |

The programmatic layer flags anomalies, then the LLM interprets and decides on action.

### 8. Intent, Not Strings

Validation is about *intent*, not surface similarity. Add to validation prompt:

```
Note: the same input may be entered with many different strings.
Your job is to discern different *intent*.

Same intent, different strings:
- "later today: do xyz"
- "do xyz this evening"

Different intent, similar strings:
- "gwen height 32""
- "jump height 30""

Same ultimate intent, but needs different treatment:
- "weight 88.2kg"
- "weight 192.9"
(the latter is the same-ish figure, but in a different unit)
```

---

## Updated Architecture

### Route Model

```typescript
interface Route {
  id: string;
  name: string;
  description: string;
  destination: Destination;

  matchers: Matcher[];  // can be empty!

  validation: {
    enabled: boolean;
    model: 'haiku' | 'sonnet';
    prompt: string | null;  // custom prompt, or use default
  };

  // Few-shot context
  context: {
    recentSuccesses: CaptureReference[];  // last N, default 10
    negativeExamples: CaptureReference[]; // rejected or corrected
    edgeCases: CaptureReference[];        // plausible/unsure that belonged
  };
}

interface Matcher {
  type: 'regex';  // prefix type removed!
  pattern: string;
  status: 'soft' | 'hard';  // hypothesis vs graduated
  fireCount: number;        // for soft matchers
  stats: {
    totalFires: number;
    lastFired: Date | null;
    validationResults: Record<ConfidenceLevel, number>;
  };
}

type ConfidenceLevel =
  | 'certain'
  | 'confident'
  | 'plausible'
  | 'unsure'
  | 'doubtful'
  | 'reject';
```

### Validation Prompt Template

```
You are validating whether an input belongs to the "{routeName}" route.

Route description: {description}
Matcher that fired: {matcherPattern}

Recent items that correctly belong here:
{recentSuccesses with timestamps}

Items that were incorrectly sent here (negative examples):
{negativeExamples if any}

Edge cases that ultimately belonged:
{edgeCases if any}

---

New input to validate:
"{payload}"

Does this input belong to this route? Consider:
- Does this match the *intent* of items here, not just surface similarity?
- Does the matcher that fired make sense for this input?
- Is there anything "off" that suggests this is a different kind of thing?

Think through your reasoning, then end with your conclusion.

End your response with: conclusion: <level>

Where <level> is one of:
- certain: unambiguously belongs here
- confident: very likely belongs, minor differences
- plausible: could belong, something slightly off
- unsure: genuinely ambiguous
- doubtful: probably doesn't belong
- reject: definitely wrong route
```

### Validation Flow

```
Input arrives
      ↓
Dispatcher checks matchers
      ↓
┌─────────────────────────────────────┐
│ No match?                           │
│   → Mastermind handles              │
│   → May create soft route           │
└─────────────────────────────────────┘
      ↓ (match found)
┌─────────────────────────────────────┐
│ Soft matcher?                       │
│   → Don't auto-execute              │
│   → Send to Mastermind with context │
│   → Mastermind may graduate it      │
└─────────────────────────────────────┘
      ↓ (hard matcher)
┌─────────────────────────────────────┐
│ Validation enabled?                 │
│   → Call Haiku/Sonnet               │
│   → Get confidence level            │
└─────────────────────────────────────┘
      ↓
┌─────────────────────────────────────┐
│ certain/confident → Execute         │
│ plausible → Execute, flag review    │
│ unsure → Mastermind decides         │
│ doubtful → Mastermind + hygiene     │
│ reject → Mastermind + hygiene       │
└─────────────────────────────────────┘
```

---

## LLM Test Cases

Tests run at normal temperature with 3/3 agreement requirement. Output parsed by looking for `conclusion: <level>` at end.

### Test: Broad matcher catches unrelated input

```
Route: gwen_memories
Description: "Log memories about Gwen with date"
Matchers:
  - /gwen\s?memor(y|ies)/i (hard)
  - /^log/ (hard) ← too broad

Recent successes:
  - "gwen memory: you said milk for the first time"
  - "gwenmemory you look so cute with your hair like a who"
  - "gwen memories: your hair is curlier than artemis's"
  - "gwen memories: you're so beautiful"

Input: "log today's pushups to pushups.csv: 10"
Matched via: /^log/

Expected: doubtful or reject
Expected side effect: triggers route hygiene review
```

### Test: Specific matcher catches correct input

```
Route: gwen_memories
Description: "Log memories about Gwen with date"
Matchers:
  - /gwen\s?memor(y|ies)/i (hard)

Recent successes:
  - "gwen memory: you said milk for the first time"
  - "gwenmemory you look so cute with your hair like a who"

Input: "gwen memories: you love reading the jabberwocky"
Matched via: /gwen\s?memor(y|ies)/i

Expected: certain or confident
```

### Test: Semantic rejection despite pattern match

```
Route: weightlog
Description: "Track body weight measurements"
Matchers:
  - /weight\s*\d/i (hard)

Recent successes:
  - "weight 88.2kg"
  - "weight 88.1kg"
  - "weight 87.9kg"

Input: "weight 2kg package arrived"
Matched via: /weight\s*\d/i

Expected: doubtful or reject
Reason: This is about a package, not body weight
```

### Test: Ambiguous input handled appropriately

```
Route: weightlog
Description: "Track body weight measurements"
Matchers:
  - /weight/i (hard)

Recent successes:
  - "weight 88.2kg"
  - "weight 88.1kg"

Input: "baby weight 10.3kg"
Matched via: /weight/i

Expected: unsure
Reason: Could be separate baby weight tracking
```

---

## Implementation Notes

### Mastermind Prompt Updates

When Mastermind creates routes, it should:
1. Prefer specific regexes over broad ones
2. Create soft matchers by default (graduate after evidence)
3. Consider: "Could this pattern match unintended things?"
4. When adding a new matcher, evaluate existing matchers for redundancy

### Migration

- Remove `prefix` matcher type from codebase
- Existing prefix matchers will simply stop matching
- System self-repairs as new inputs arrive and Mastermind creates proper regex matchers

### Route Hygiene Check

When triggered (by signal), compute:
1. Matcher fire statistics (which matchers are actually being used?)
2. Validation result distribution per matcher
3. Any matchers with high `doubtful`/`reject` rate?
4. Any matchers that never fire?

Present findings to LLM for interpretation and action recommendation.

---

## Success Criteria

- [ ] Prefix matcher type removed
- [ ] Soft/hard matcher distinction implemented
- [ ] Named confidence levels in validation
- [ ] Validation sees matcher that fired
- [ ] Route hygiene triggers on signal (doubtful, reject, correction)
- [ ] LLM test suite with 3/3 agreement
- [ ] "gwen_memories + pushups" case correctly returns doubtful/reject
- [ ] Soft matchers graduate after consistent fires
- [ ] Mastermind creates soft matchers by default
