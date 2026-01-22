okay new, related change.  I just did tests starting with `gwen memories:` - not identical, so doesn't match the route
when the mastermind matches a non-auto-routed input to an existing route
another LLM prompt should fire that is shown the existing matcher(s) for that route, and is offered to create another or modify
existing ones.  I guess we should show them numbered.

so suppose it sees
existing routes:
1. /^gwen memory: (.*)/
but the new one is plural.  it might send back
new: /^gwen memories: (.*)/

then it gets gwenmemory: xyz
and it has the previous 2 listed matchers
and it responds
remove1,2.  new: /^gwen ?memor(y|ies): (.*)/

probably you can come up with better syntax!

ALSO!  this is the part where the whole system should then RETEST all of the previous inputs for this route to ensure they still
match, and ALSO should RETEST all of the previous inputs from OTHER routes to ensure they DON'T match.  and if either of those
fails, this new LLM is fired again with its usual context plus the new issue to try to work around.

if it can't / gets confused, then it should flag that for the user.

oh also this llm should receive some of the same route-matching stuff (last N slaps sent to various routes) that the other
mastermind prompt receives, so that it can grok WHY the mastermind made the new match. in general, we probably want to consider
this step part of the masterminding

oh actually wait.  in some cases (examples in spec with kg vs lbs) it may need not just another matcher but another pre-transform
step. so that should really be the unit here.  it should either modify an existing matcher+transform, or make a new
matcher+transform (which might have the same transform step).  the transform steps should be somehow referenceable so we aren't
just completely duplicating code when they ARE the same. 





one of the case studies is like, suppose I have a weight spreadsheet, and I send these inputs (which
incidentally are getting tagged by date)

weight: 88.2kg
weight 88.3kg
weight 88.1
weight 194.1

LLMs are absolutely smart enough to realize I have put my weight in in lbs today, even if the units aren't specified.  but in
THIS particular case, the router would have _thought_ it sent a perfect match (not so if we were using kg before).  I honestly
think there's an architecture that can sanely handle this, and I articulated it as Phase 4: Validation Layer.  which we should
add.

but not for now.  the only thing you need to do now is design the system you're building such that it could ALSO be used when
the following occurs:
automatch -> yes
validation -> uhh
[this guy we're building] -> ahh I see.  *rewrites handler to divide by 2.205 if >140*

this guy we're building should therefore definitely be seeing the transform function.  also we might want to reuse the kg/lbs
logic elsewhere, but with a different threshold!  so that should be a parameter, not hardcoded.  




 like one of the most important abstractions we'll want to build are things for formatting outputs
eg suppose that instead of appending to a file we're trying to locate a certain cell in a spreadsheet and input into it
the lookup will take variables, and the lookup PROCESS might use different header rows / entry columns...
but we don't want to have to rewrite the lookup FUNCTION every time

once we figure out how to do it, we should just lock that in!
