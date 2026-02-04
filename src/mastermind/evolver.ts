// src/mastermind/evolver.ts
//
// ╔════════════════════════════════════════════════════════════════════════════╗
// ║                         TEST RATCHET SYSTEM                                ║
// ╠════════════════════════════════════════════════════════════════════════════╣
// ║ When modifying the evolver prompt below, you MUST:                         ║
// ║                                                                            ║
// ║ 1. Run the evolver test suite first:                                       ║
// ║    pnpm test:evolver                                                       ║
// ║                                                                            ║
// ║ 2. If a test case fails showing a regression you want to fix:              ║
// ║    - Fix the prompt                                                        ║
// ║    - The failing input is already saved as a ratchet case                  ║
// ║                                                                            ║
// ║ 3. If the evolver misbehaved in production:                                ║
// ║    - The call was auto-saved as a test case                                ║
// ║    - If it evolved when it shouldn't have, it's a ratchet case             ║
// ║    - Fix the prompt to make the test pass                                  ║
// ║                                                                            ║
// ║ 4. Run tests again before committing:                                      ║
// ║    pnpm test:evolver                                                       ║
// ║                                                                            ║
// ║ Test cases are stored in: data/evolver-tests/                              ║
// ║ - Ratchet cases (evolved): never auto-deleted, serve as regression tests   ║
// ║ - Non-ratchet cases (skipped): rolling window of last 5                    ║
// ║                                                                            ║
// ║ See: src/mastermind/evolver-test-runner.ts                                 ║
// ║      src/mastermind/evolver-ratchet.ts                                     ║
// ╚════════════════════════════════════════════════════════════════════════════╝
//
import Anthropic from '@anthropic-ai/sdk';
import { Route, RouteTrigger, EvolverResult, Capture } from '../types.js';
import { MASTERMIND_PRINCIPLES } from './principles.js';

export interface EvolverContext {
  newInput: string;
  route: Route;
  mastermindReason: string;
  validationFailure?: {
    errors: string[];
    otherRoutesTriggers?: Array<{ routeName: string; triggers: RouteTrigger[] }>;
  };
  /** Tiered validation results - only present after first validation attempt */
  tieredValidation?: TieredValidationResult;
}

/**
 * Format a relative date string like "9h ago" or "14d ago"
 */
function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else {
    return `${diffDays}d ago`;
  }
}

/**
 * Result of tiered validation - categorizes captures by verification state.
 */
export interface TieredValidationResult {
  /** Captures that are human_verified and would no longer match - blocks evolution */
  hardBlocked: Capture[];
  /** Captures that are ai_certain and would no longer match - can be overridden with justification */
  softBlocked: Capture[];
  /** Captures that are unverified and would no longer match - freely re-routable */
  freedCaptures: Capture[];
  /** Collision errors - captures from other routes that would match */
  collisions: string[];
}

export class Evolver {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  buildPrompt(context: EvolverContext): string {
    const { newInput, route, mastermindReason, validationFailure } = context;

    const triggersDesc = route.triggers
      .map((t, i) => `  ${i}. ${t.type}: "${t.pattern}" (priority ${t.priority})`)
      .join('\n');

    const recentItems = route.recentItems
      .slice(0, 5)
      .map(item => `  - "${item.raw}"`)
      .join('\n');

    let prompt = `${MASTERMIND_PRINCIPLES}

---

## Context: Trigger Evolution

You are operating in evolution mode. The Mastermind (you, in routing mode) just routed an input to this route. Now you're deciding whether to add a trigger so similar inputs get auto-routed next time.

## Current Route: ${route.name}
Description: ${route.description}

### Existing Triggers (numbered for reference):
${triggersDesc || '(none)'}

### Transform Script:
${route.transformScript || '(none)'}

### Recent Successful Matches:
${recentItems || '(none)'}

## New Input That Was Just Routed Here
"${newInput}"

## Why It Was Routed Here
${mastermindReason}

## Your Task

The Mastermind routed this input, but it required LLM judgment. Your job: should there be a trigger that catches this automatically next time?

If this looks like a user habit or shorthand (a word/phrase they'd likely repeat), add it as a draft trigger. If it's a one-off phrasing or genuinely ambiguous between multiple routes, skip.

Draft triggers are cheap - the validation layer tests them. Skipping means future similar inputs still need Mastermind consultation.

## Response Format

Respond with JSON only:

To skip (input is one-off or ambiguous):
{"action": "skip", "reasoning": "..."}

To add trigger(s):
{"triggers": [{"type": "regex", "pattern": "your-regex-here", "priority": 10, "status": "draft"}, ...], "reasoning": "..."}

To modify transform (rare):
{"transform": "...", "reasoning": "..."}

## Trigger Rules

- ONLY "regex" type is allowed (prefix, keyword are deprecated)
- New triggers MUST have "status": "draft" - they graduate to "live" after validation
- For prefix-like matching, use anchored regex: ^pattern\\b
- Avoid overly broad patterns like "^log" that match unrelated things
- User-specific shorthands like "liftlog" or "moodlog" are good - they're distinctive`;

    // Add validation failure context on retry
    if (validationFailure) {
      prompt += `

## VALIDATION FAILED - Previous Attempt
Your last proposal failed validation:
${validationFailure.errors.map(e => `- ${e}`).join('\n')}`;

      if (validationFailure.otherRoutesTriggers) {
        prompt += `

## Other Routes' Triggers (avoid collisions):
${validationFailure.otherRoutesTriggers.map(r =>
  `- ${r.routeName}: ${r.triggers.map(t => `${t.type}:"${t.pattern}"`).join(', ')}`
).join('\n')}`;
      }
    }

    // Add tiered validation context if present
    if (context.tieredValidation) {
      const { softBlocked, freedCaptures, collisions } = context.tieredValidation;

      // Soft-blocked captures (ai_certain) - can be overridden with justification
      if (softBlocked.length > 0) {
        prompt += `

## Soft-Protected Captures (AI-Verified)
These captures were routed here with AI certainty but no human verification.
You MAY override them if you believe the original routing was incorrect.
For each override, provide justification in the "overrideJustifications" field.

${softBlocked.map((c, i) =>
  `[${i + 1}] "${c.raw}"
    routed: ${c.routeFinal ? c.timestamp.split('T')[0] : 'unknown'} (${formatRelativeDate(c.timestamp)}) | verification: ${c.verificationState}`
).join('\n\n')}`;
      }

      // Freed captures - these no longer match and need action
      if (freedCaptures.length > 0) {
        prompt += `

## Freed Captures (No Longer Match Your Proposed Triggers)
These captures were routed here but would no longer match if your triggers are applied.
Since they weren't verified, they can be re-routed. For each, specify an action in "freedCaptureActions".

${freedCaptures.map((c, i) =>
  `[${i + 1}] "${c.raw}"
    routed: ${c.timestamp.split('T')[0]} (${formatRelativeDate(c.timestamp)}) | verification: ${c.verificationState}`
).join('\n\n')}

For each freed capture, respond with one of:
- "RE_ROUTE": Capture should be re-routed through the pipeline (specify suggestedRoute if known)
- "MARK_FOR_REVIEW": Flag for human review in dashboard
- "LEAVE_AS_HISTORICAL": Keep as-is but exclude from future regression checks`;
      }

      // Collision errors
      if (collisions.length > 0) {
        prompt += `

## COLLISION ERRORS
Your proposed triggers would match captures from other routes:
${collisions.map(c => `- ${c}`).join('\n')}

You must modify your triggers to avoid these collisions.`;
      }

      // Update response format if we have tiered context
      if (softBlocked.length > 0 || freedCaptures.length > 0) {
        prompt += `

## Extended Response Format

When soft-blocked or freed captures are present, include these fields:

{
  "triggers": [...],
  "reasoning": "...",
  "overrideJustifications": {
    "1": "Reason why capture 1 was incorrectly routed here",
    "2": "Reason why capture 2 was incorrectly routed here"
  },
  "freedCaptureActions": {
    "1": { "action": "RE_ROUTE", "suggestedRoute": "fitness_log", "reasoning": "Contains pushups data" },
    "2": { "action": "LEAVE_AS_HISTORICAL", "reasoning": "Old format, no longer relevant" }
  }
}`;
      }
    }

    return prompt;
  }

  /**
   * Evolve a route's triggers/transform.
   * Returns the result along with the prompt used for retroactive replay.
   */
  async evolve(context: EvolverContext): Promise<{ result: EvolverResult; promptUsed: string }> {
    const prompt = this.buildPrompt(context);

    try {
      const response = await this.client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return {
          result: {
            action: 'failed',
            reasoning: 'Unexpected response type from API',
          },
          promptUsed: prompt,
        };
      }

      return {
        result: this.parseResponse(content.text),
        promptUsed: prompt,
      };
    } catch (error) {
      return {
        result: {
          action: 'failed',
          reasoning: `API error: ${error instanceof Error ? error.message : String(error)}`,
        },
        promptUsed: prompt,
      };
    }
  }

  parseResponse(responseText: string): EvolverResult {
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          action: 'failed',
          reasoning: 'No JSON found in response',
        };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Check for skip action
      if (parsed.action === 'skip') {
        return {
          action: 'skipped',
          reasoning: parsed.reasoning || 'Skipped by evolver',
        };
      }

      // Check for evolution (triggers or transform)
      if (parsed.triggers || parsed.transform) {
        return {
          action: 'evolved',
          triggers: parsed.triggers,
          transform: parsed.transform,
          reasoning: parsed.reasoning || 'Evolved by evolver',
          overrideJustifications: parsed.overrideJustifications,
          freedCaptureActions: parsed.freedCaptureActions,
        };
      }

      return {
        action: 'failed',
        reasoning: 'Invalid response: missing triggers, transform, or skip action',
      };
    } catch (error) {
      return {
        action: 'failed',
        reasoning: `Failed to parse response: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Validate proposed changes with tiered protection based on verificationState.
   *
   * Protection tiers:
   * - human_verified: Hard block - requires human review queue
   * - ai_certain: Soft block - evolver can override with justification
   * - ai_uncertain/pending/failed: No protection - freely re-routable
   * - retiredFromTests: Excluded entirely from checks
   */
  validateChangesTiered(
    proposedTriggers: RouteTrigger[],
    routeId: string,
    allCaptures: Capture[],
    allRoutes: Route[]
  ): TieredValidationResult {
    const hardBlocked: Capture[] = [];
    const softBlocked: Capture[] = [];
    const freedCaptures: Capture[] = [];
    const collisions: string[] = [];

    // Get this route's captures, excluding retired ones
    const thisRouteCaptures = allCaptures.filter(
      c => c.routeFinal === routeId && !c.retiredFromTests
    );

    // Categorize captures that no longer match by verification state
    for (const capture of thisRouteCaptures) {
      if (!this.matchesTriggers(capture.raw, proposedTriggers)) {
        // Capture no longer matches - categorize by verification state
        if (capture.verificationState === 'human_verified') {
          hardBlocked.push(capture);
        } else if (capture.verificationState === 'ai_certain') {
          softBlocked.push(capture);
        } else {
          // ai_uncertain, pending, failed, or undefined
          freedCaptures.push(capture);
        }
      }
    }

    // Check for collisions with other routes' captures (regardless of verification state)
    const otherCaptures = allCaptures.filter(
      c => c.routeFinal && c.routeFinal !== routeId && !c.retiredFromTests
    );
    for (const capture of otherCaptures) {
      if (this.matchesTriggers(capture.raw, proposedTriggers)) {
        const otherRoute = allRoutes.find(r => r.id === capture.routeFinal);
        collisions.push(
          `Collision: "${capture.raw}" (belongs to ${otherRoute?.name || capture.routeFinal}) would match this route`
        );
      }
    }

    return { hardBlocked, softBlocked, freedCaptures, collisions };
  }

  /**
   * Validate proposed changes by replaying all captures.
   * Legacy API - uses tiered validation internally but returns simple pass/fail.
   */
  validateChanges(
    proposedTriggers: RouteTrigger[],
    routeId: string,
    allCaptures: Capture[],
    allRoutes: Route[]
  ): { passed: boolean; errors: string[] } {
    const tiered = this.validateChangesTiered(proposedTriggers, routeId, allCaptures, allRoutes);
    const errors: string[] = [];

    // For legacy API: hard and soft blocked both count as regressions
    for (const capture of tiered.hardBlocked) {
      errors.push(`Regression: "${capture.raw}" no longer matches this route`);
    }
    for (const capture of tiered.softBlocked) {
      errors.push(`Regression: "${capture.raw}" no longer matches this route`);
    }
    // freedCaptures are NOT regressions in legacy API

    errors.push(...tiered.collisions);

    return {
      passed: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if input matches any of the triggers
   * Phase 4: Only regex triggers are supported
   */
  private matchesTriggers(input: string, triggers: RouteTrigger[]): boolean {
    for (const trigger of triggers) {
      if (trigger.type !== 'regex') {
        continue; // Only regex triggers supported
      }

      try {
        const regex = new RegExp(trigger.pattern, 'i');
        if (regex.test(input)) {
          return true;
        }
      } catch {
        // Invalid regex, skip
      }
    }

    return false;
  }
}
