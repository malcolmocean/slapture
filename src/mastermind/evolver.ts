// src/mastermind/evolver.ts
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

    let prompt = `You are the Slapture Evolver. Your job is to evolve a route's triggers and/or transform to handle new input variations.

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
Analyze whether the triggers and/or transform need modification to handle this input pattern going forward.

Guidelines:
- Only modify what's necessary
- Prefer regex patterns that handle variations (singular/plural, spacing, etc.)
- Keep patterns specific enough to avoid matching unrelated inputs
- If the input is a typo or one-off, you can skip evolution

## Response Format
Respond with JSON only. Include only the sections being modified:

If modifying triggers only:
{"triggers": [{type, pattern, priority}, ...], "reasoning": "..."}

If modifying transform only:
{"transform": "...", "reasoning": "..."}

If modifying both:
{"triggers": [...], "transform": "...", "reasoning": "..."}

If skipping (typo, not worth capturing):
{"action": "skip", "reasoning": "..."}`;

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

  async evolve(context: EvolverContext): Promise<EvolverResult> {
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
          action: 'failed',
          reasoning: 'Unexpected response type from API',
        };
      }

      return this.parseResponse(content.text);
    } catch (error) {
      return {
        action: 'failed',
        reasoning: `API error: ${error instanceof Error ? error.message : String(error)}`,
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
