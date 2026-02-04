# Tiered Regression Validation - Not Yet

## Status: Needs Real Usage Data

The tiered regression protection system (2026-01-29) is implemented but lacks LLM validation tests. We're not yet sure what the tests should look like.

## What's Implemented

- Hard blocks (human_verified captures)
- Soft blocks (ai_certain captures, can override with justification)
- Freed captures with actions: RE_ROUTE, MARK_FOR_REVIEW, LEAVE_AS_HISTORICAL

## Why We're Waiting

Re-routing is complex. The system isn't really set up for "de-routing" - splitting apart data that was previously combined.

### Example That Illustrates the Complexity

User tracks "baby weight" for their first child. Then they have a second baby. Now they need:
- `ava weight 10.2kg` → ava_weight route
- `bia weight 4.1kg` → bia_weight route

The old "baby weight" captures need to become "ava weight" captures. This is de-routing/splitting, not just re-routing.

### Another Example

User starts logging "pushups" and "squats" to the same `workout_log`. Later they want separate tracking. The old combined entries need to be peeled apart - but something generic like "30min workout" should just stay as historical.

## What We Need

Real usage patterns to understand:
1. When does re-routing actually make sense vs leaving historical?
2. How should de-routing/splitting work?
3. What validation tests would actually catch real problems?

## When to Revisit

Once we have:
- Multiple real users with real routing patterns
- Actual examples of trigger evolution causing freed captures
- User feedback on what went wrong when it did
