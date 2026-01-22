# Evolver Improvements: Conservative Behavior + Test Ratcheting

## Malcolm's Original Request

> okay we're evolving the evolver, as part of making your recursively self-improving mechsuit.
>
> in general, there should be like a "default capture" spot, and if something gets sent there, the evolver will often NOT have any new change to make and should conclude that and not try to make one
>
> in contrast with this wrong behavior (note: create inbox was GREAT)
> ```
> Slapture server running on http://localhost:3333
> [Pipeline] No route matched, consulting Mastermind for: "inbox: check for more usb cables"
> [Pipeline] Mastermind action: create inbox
> [Pipeline] No route matched, consulting Mastermind for: "re-wipe usb disk before returning"
> [Pipeline] Mastermind action: route inbox
> [Pipeline] Resolved route: route-d0867a94-9bfd-46ac-ad45-65b5a1397f2b
> [Pipeline] Evolver attempt 1/3 for route inbox
> [Pipeline] Evolver result: evolved - The new input 're-wipe usb disk before returning' is a task/todo without the 'inbox:' prefix. Adding a lower-priority regex to catch common task-like patterns starting with action verbs or task-related keywords. The existing prefix trigger remains at higher priority for explicit inbox routing.
> [Pipeline] Validation failed: Collision: "dump buy sleepsack" (belongs to dump) would match this route
> [Pipeline] Evolver attempt 2/3 for route inbox
> [Pipeline] Evolver result: evolved - Adding a specific pattern for disk/drive wiping tasks. The pattern requires both an action verb (wipe/format/erase) AND a storage device noun (disk/drive/usb/sd/card) to avoid matching unrelated inputs like 'dump buy sleepsack'. The optional 're-' prefix handles variations like 're-wipe'.
> [Pipeline] Evolution applied to route inbox
> ```
>
> basically: don't overfit things. only add/modify route if it's obvious that it should match this new thing every time. if no obvious, no change. stay loose.
>
> so that's a fairly small modification to the evolver prompt & output parser
>
> however: on a *meta* level, we should keep test-cases for iterating the prompt, to avoid regressions. and in order to do *that*, we need to be saving exactly what the dynamic input was (that gets combined with the prompt) so that we can test against it. it's going to fairly soon be unwieldy to test against all past test cases, but we can come up with some sampling system that at least tests it against the last 5 evolver calls, and also any previous evolver calls *that resulted in a modification to the prompt* this is a self-improving system, and we want to ratchet. so there should be a note somewhere next to the evolver prompt, that *when updating the prompt* the coder (AI or human) is to add the failed event to a list of things that the evolver is to be tested on
>
> we're already storing every capture, although they're stored by uuid at present which is not going to allow for easy historical lookup. we should use captures/:username/:isodate_:uuid.json
>
> write and run a tiny script to restructure the existing captures (for the 'default' user). all the data is there.
>
> HOWEVER! the data that is not currently there is "what was shown to the LLMs at each step?" that should include both whatever the static prompt was at the time, and also whatever the dynamic input was
>
> (also I'm not sure if we're storing the evolver step in the capture log at all, at present. we should always store ALL STEPS, even new ones added! make a note of that somewhere prominent.)
>
> ultimately when things stabilize a bit more (and grow more in total size) we'll save HD space by storing the prompts in separate files and referring to them by timestamp, but for now let's just include them as literals for easy human debugging. besides, the dynamic part will be changing literally every time anyway, since it's "recent stuff"
>
> basically as the system evolves, we should be able to retroactively plug old runs in, in some form

---

## Implementation Plan

### Phase 1: Core Changes (DONE)

- [x] **Conservative evolver prompt** - Modified `src/mastermind/evolver.ts` to default to "skip". Only evolve when pattern is OBVIOUS and ALWAYS-CORRECT. The Mastermind already routes correctly; don't overfit triggers.

- [x] **Captures restructure** - Changed from `captures/:uuid.json` to `captures/:username/:isodate_:uuid.json`. Storage methods updated to handle both legacy flat format and new nested format.

- [x] **Migration script** - Created `scripts/migrate-captures.ts` to move existing captures into `default/` subdirectory with new naming. Ran successfully on 31 captures.

### Phase 2: LLM Input Tracing (DONE)

- [x] **Store LLM inputs in execution trace** - For each LLM call (Mastermind, Evolver), store:
  - `staticPrompt`: The full prompt template as it existed at call time
  - `dynamicInput`: The specific data that was interpolated (routes, recent items, new input, etc.)
  - This enables retroactive replay when prompts change

- [x] **Add evolver step to execution trace** - Now calls `addTrace(capture, 'evolve', ...)` in `tryEvolveRoute()` with full context including:
  - Input: route being evolved, new input, mastermind reason
  - Output: evolver result (action, triggers, transform, reasoning)
  - The prompt shown to the LLM

- [x] **EvolverTestCase infrastructure** - Added type and storage methods (save, list, delete, prune)

### Phase 2.5: Complete Dynamic Input Capture (TODO)

The current `dynamicInput` stored in traces is incomplete for true retroactive replay:

**Mastermind** - Currently stores `{ raw, parsed, dispatcherReason, routeCount }` but the prompt also includes:
- Each route's full description, triggers, and recent items (up to 3 per route)
- This changes over time as routes are used/evolved

**Evolver** - Currently stores `{ newInput, routeId, routeName, mastermindReason, attempt }` but the prompt also includes:
- The route's current triggers (numbered list)
- The route's transform script
- The route's recent successful matches (up to 5)

**Why this matters**: If we replay an old capture against a modified prompt, we need to know exactly what the LLM saw at that time. The routes' recent items and triggers change constantly, so without capturing them we can't reproduce the original decision context.

**Fix**: Expand `dynamicInput` to include snapshots of all route data shown to the LLM at call time, not just IDs/names.

### Phase 3: Test Ratcheting System (TODO)

- [x] **Evolver test case storage** - `data/evolver-tests/` directory exists. `EvolverTestCase` type defined in types.ts with storage methods in storage/index.ts.

- [ ] **Auto-save test cases** - When evolver runs:
  1. Always save the evolver call as a test case with `isRatchetCase: false`
  2. Prune to keep only the last 5 non-ratchet cases (rolling window)

- [ ] **Ratchet cases** - Manually added by developers when fixing the evolver prompt:
  1. When evolver misbehaves, developer fixes the prompt
  2. Developer adds that specific input as a test case with `isRatchetCase: true`
  3. Ratchet cases are never auto-deleted

- [ ] **Test runner for prompt iteration** - When updating the evolver prompt:
  1. Run all test cases (last 5 auto-saved + all ratchet cases) through new prompt
  2. Verify no regressions (cases that should skip still skip, cases that should evolve still evolve)
  3. Report any failures

- [ ] **Prominent note in evolver.ts** - Add comment block explaining:
  - The test ratchet system
  - When modifying the prompt, add the failing input as a ratchet case
  - Run test runner before committing prompt changes

### Phase 4: Future Optimizations (DEFERRED)

- [ ] Store prompts in separate files by timestamp/hash to save space
- [ ] Implement sampling system for large test case sets
- [ ] Add "retire" mechanism for test cases that are no longer relevant

---

## Files Modified

- `src/mastermind/evolver.ts` - Conservative prompt, will add test case saving
- `src/storage/index.ts` - New capture path format, evolver-tests directory
- `src/pipeline/index.ts` - Pass username to saveCapture, will add evolver trace
- `scripts/migrate-captures.ts` - One-time migration (already ran)

## Commit History

1. `9ccb972` - feat: conservative evolver + captures restructure (Phase 1 complete)
2. `0e35177` - feat: add LLM input tracing and evolver test case infrastructure (Phase 2 complete)
