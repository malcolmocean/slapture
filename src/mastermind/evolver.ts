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

    let prompt = `You are the Slapture Evolver. Your job is to CONSERVATIVELY evolve a route's triggers and/or transform.

## CRITICAL: Default to "skip"

Your default action should be "skip". Only evolve when the new input represents a CLEAR, OBVIOUS pattern that should ALWAYS match this route. Ask yourself: "Is there any reasonable interpretation where this input should NOT go to this route?" If yes, skip.

DO NOT overfit. The Mastermind already routed this correctly - you don't need to "capture" every variation. Only add patterns for:
1. Clear typos/spacing variants of existing triggers (e.g., "gwenmemory" → "gwen memory")
2. Obvious synonyms that will ALWAYS mean the same thing
3. Structural patterns where the STRUCTURE itself guarantees the intent

If the input is just "something that could go here this time", that's the Mastermind's job - NOT a trigger.

## Current Route: ${route.name}
Description: ${route.description}

### Triggers (numbered for reference):
${triggersDesc}

### Transform Script:
${route.transformScript || '(none)'}

### Recent Successful Matches:
${recentItems || '(none)'}

## New Input That Triggered Evolution
"${newInput}"

## Why Mastermind Matched It
${mastermindReason}

## Your Task
Decide if this input reveals an OBVIOUS, ALWAYS-CORRECT pattern that's missing from triggers. Most of the time, the answer is NO - the Mastermind handled it, that's fine.

## Response Format
Respond with JSON only:

DEFAULT (use this most of the time):
{"action": "skip", "reasoning": "The input was correctly routed by Mastermind but doesn't represent a universal pattern - [explain why it's situational]"}

ONLY if clearly missing an obvious pattern:
{"triggers": [{type, pattern, priority}, ...], "reasoning": "Adding [specific pattern] because it will ALWAYS mean this route: [concrete explanation]"}

If modifying transform (rare):
{"transform": "...", "reasoning": "..."}`;

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
   */
  private matchesTriggers(input: string, triggers: RouteTrigger[]): boolean {
    const normalizedInput = input.toLowerCase().trim();

    for (const trigger of triggers) {
      switch (trigger.type) {
        case 'prefix':
          if (normalizedInput.startsWith(trigger.pattern.toLowerCase())) {
            return true;
          }
          break;
        case 'keyword':
          if (normalizedInput.includes(trigger.pattern.toLowerCase())) {
            return true;
          }
          break;
        case 'regex':
          try {
            const regex = new RegExp(trigger.pattern, 'i');
            if (regex.test(input)) {
              return true;
            }
          } catch {
            // Invalid regex, skip
          }
          break;
        case 'semantic':
          // Semantic matching would require LLM - skip for validation
          break;
      }
    }

    return false;
  }
}
