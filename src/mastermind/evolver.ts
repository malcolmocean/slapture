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
   * Validate proposed changes by replaying all captures
   */
  validateChanges(
    proposedTriggers: RouteTrigger[],
    routeId: string,
    allCaptures: Capture[],
    allRoutes: Route[]
  ): { passed: boolean; errors: string[] } {
    const errors: string[] = [];

    // Test 1: This route's captures still match
    const thisRouteCaptures = allCaptures.filter(c => c.routeFinal === routeId);
    for (const capture of thisRouteCaptures) {
      if (!this.matchesTriggers(capture.raw, proposedTriggers)) {
        errors.push(`Regression: "${capture.raw}" no longer matches this route`);
      }
    }

    // Test 2: Other routes' captures don't match
    const otherCaptures = allCaptures.filter(c => c.routeFinal && c.routeFinal !== routeId);
    for (const capture of otherCaptures) {
      if (this.matchesTriggers(capture.raw, proposedTriggers)) {
        const otherRoute = allRoutes.find(r => r.id === capture.routeFinal);
        errors.push(`Collision: "${capture.raw}" (belongs to ${otherRoute?.name || capture.routeFinal}) would match this route`);
      }
    }

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
