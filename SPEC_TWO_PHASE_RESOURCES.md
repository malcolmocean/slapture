# Two-Phase Mastermind & Unified Resource Inventory

## Status: Future spec — not yet implemented

## Problem

Currently the Mastermind handles "does this match an existing route?" and "where should this new thing go?" in a single prompt. This means:

1. Every Mastermind invocation gets the full context even when an existing route is obviously right
2. When creating a new route, the Mastermind doesn't have visibility across ALL integrations to make the best choice — it can't tell from "movies" whether to look for a movies spreadsheet or a movies Roam tag
3. Users have to over-hint on first use because the system can't browse available resources

## Proposed Architecture

### Phase 1: Quick route matching (cheap)

"Does an existing route obviously match this capture?"

- Looks only at existing routes
- No integration context injection
- Fast, low token cost
- If answer is "yes" → route and done

### Phase 2: Rich resource discovery (only if Phase 1 says no)

"Where should this go?"

Gets injected with a **unified resource inventory** across ALL integrations:

```
- roam
  - graph: malcolm
    - page: [[movie reco]]
    - page: [[bodylog]]
  - graph: malcolmocean (public)
    - page: #2tweet
    - page: [[metaphor]]
- gsheets
  - bookantt chart
  - weight log
  - gwen memories
  - (any other sheet titles from past ~1y)
- intend
  - today's intentions
  - draft for today
  - draft for tomorrow
```

Picks integration + high-level destination first, then figures out the write pattern.

Could potentially be scoped to a single integration if Phase 1 narrows it down (e.g. user said "roam" but didn't say which graph) — but that optimization may not be worth the complexity.

### Write pattern selection

After identifying the right destination (page/sheet/etc), there's still the question of HOW to write:

- **Roam:** write to today's page (tagged) vs. append as child of a block on a named page
- **Sheets:** append row, lookup + set cell, lookup + append to row
- **Intend:** end of list (default) vs. next intention (makeCurrent)

This is a third sub-decision that may warrant its own step, or may fold into Phase 2.

## First-Use Hints

Users will often include routing hints on first use of a new pattern:

- "movie reco terminator 2 (roam)" — the "(roam)" is a hint
- "weight 185.5 gsheets" — the "gsheets" is a hint
- "intend: go for a walk" — the "intend:" prefix is a hint

**Critical rule for the entire system (not just Roam):**

> These hints are signals for route creation, NOT part of the recurring pattern. When creating triggers, match the semantic content, not the hint. The hint should also be stripped from the payload before writing to the destination. Future captures of the same type should route correctly WITHOUT the hint, because the route + triggers now exist.

The evolver must also understand this: when generalizing triggers from examples, it should strip hint-like suffixes/prefixes that won't recur.

## Resource List Sizing

For integrations with potentially large inventories (Roam pages, Sheets):
- Cap at roughly 200 most recent + 200 most used, deduped
- Exclude date/daily pages (Roam) — these are deterministic and don't need listing
- Usually well under 300 total, but allow for more after dedup

## Relationship to Current System

Until this is implemented, the Mastermind works as it does today — single prompt, users need to hint more explicitly for new routes. The Roam integration (and others) inject their context at the existing integration-context level, which works but requires the user to indicate the integration.
