okay we're evolving the evolver, as part of making your recursively self-improving mechsuit.

in general, there should be like a "default capture" spot, and if something gets sent there, the evolver will often NOT have any new change to
make and should conclude that and not try to make one

in contrast with this wrong behavior (note: create inbox was GREAT)
```
Slapture server running on http://localhost:3333
[Pipeline] No route matched, consulting Mastermind for: "inbox: check for more usb cables"
[Pipeline] Mastermind action: create inbox
[Pipeline] No route matched, consulting Mastermind for: "re-wipe usb disk before returning"
[Pipeline] Mastermind action: route inbox
[Pipeline] Resolved route: route-d0867a94-9bfd-46ac-ad45-65b5a1397f2b
[Pipeline] Evolver attempt 1/3 for route inbox
[Pipeline] Evolver result: evolved - The new input 're-wipe usb disk before returning' is a task/todo without the 'inbox:' prefix. Adding a lower-priority regex to catch common task-like patterns starting with action verbs or task-related keywords. The existing prefix trigger remains at higher priority for explicit inbox routing.
[Pipeline] Validation failed: Collision: "dump buy sleepsack" (belongs to dump) would match this route
[Pipeline] Evolver attempt 2/3 for route inbox
[Pipeline] Evolver result: evolved - Adding a specific pattern for disk/drive wiping tasks. The pattern requires both an action verb (wipe/format/erase) AND a storage device noun (disk/drive/usb/sd/card) to avoid matching unrelated inputs like 'dump buy sleepsack'. The optional 're-' prefix handles variations like 're-wipe'.
[Pipeline] Evolution applied to route inbox
```

basically: don't overfit things.  only add/modify route if it's obvious that it should match this new thing every time. if no obvious, no change. stay loose.

so that's a fairly small modification to the evolver prompt & output parser

however: on a *meta* level, we should keep test-cases for iterating the prompt, to avoid regressions.  and in order to do *that*,
we need to be saving exactly what the dynamic input was (that gets combined with the prompt) so that we can test against it.
it's going to fairly soon be unwieldy to test against all past test cases, but we can come up with some sampling system that
at least tests it against the last 5 evolver calls, and also any previous evolver calls *that resulted in a modification to the prompt*
this is a self-improving system, and we want to ratchet.  so there should be a note somewhere next to the evolver prompt, that *when
updating the prompt* the coder (AI or human) is to add the failed event to a list of things that the evolver is to be tested on

we're already storing every capture, although they're stored by uuid at present which is not going to allow for easy historical lookup.
we should use captures/:username/:isodate_:uuid.json

write and run a tiny script to restructure the existing captures (for the 'default' user). all the data is there.

HOWEVER! the data that is not currently there is "what was shown to the LLMs at each step?"
that should include both whatever the static prompt was at the time, and also whatever the dynamic input was

(also I'm not sure if we're storing the evolver step in the capture log at all, at present. we should always store ALL STEPS,
even new ones added! make a note of that somewhere prominent.)

ultimately when things stabilize a bit more (and grow more in total size) we'll save HD space by storing the prompts in
separate files and referring to them by timestamp, but for now let's just include them as literals for easy human debugging.
besides, the dynamic part will be changing literally every time anyway, since it's "recent stuff"

basically as the system evolves, we should be able to retroactively plug old runs in, in some form
