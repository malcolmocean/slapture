// src/validation/index.ts
//
// LLM validation layer for Phase 4.
// Validates whether an input belongs to a route before execution.

import Anthropic from '@anthropic-ai/sdk';
import {
  Route,
  RouteTrigger,
  ValidationConfidence,
  CaptureRef,
} from '../types.js';

export interface ValidationContext {
  route: Route;
  matchedTrigger: RouteTrigger;
  input: string;
}

export interface ValidationResult {
  confidence: ValidationConfidence;
  reasoning: string;
}

const CONFIDENCE_LEVELS: ValidationConfidence[] = [
  'certain',
  'confident',
  'plausible',
  'unsure',
  'doubtful',
  'reject',
];

export class Validator {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  buildPrompt(context: ValidationContext): string {
    const { route, matchedTrigger, input } = context;

    // Format recent successes
    const recentSuccesses = route.recentItems
      .slice(0, 10)
      .map(item => `  - "${item.raw}" (${item.timestamp.split('T')[0]})`)
      .join('\n') || '  (none yet)';

    // Format negative examples
    const negativeExamples = route.validationContext?.negativeExamples
      ?.slice(0, 5)
      .map(item => `  - "${item.raw}"`)
      .join('\n') || '  (none)';

    // Format edge cases
    const edgeCases = route.validationContext?.edgeCases
      ?.slice(0, 5)
      .map(item => `  - "${item.raw}"`)
      .join('\n') || '  (none)';

    // Use custom prompt if provided, otherwise use default template
    if (route.validation?.prompt) {
      return route.validation.prompt
        .replace('{routeName}', route.name)
        .replace('{description}', route.description)
        .replace('{matcherPattern}', matchedTrigger.pattern)
        .replace('{recentSuccesses}', recentSuccesses)
        .replace('{negativeExamples}', negativeExamples)
        .replace('{edgeCases}', edgeCases)
        .replace('{payload}', input);
    }

    return `You are validating whether an input belongs to the "${route.name}" route.

Route description: ${route.description}
Matcher that fired: /${matchedTrigger.pattern}/i

Recent items that correctly belong here:
${recentSuccesses}

Items that were incorrectly sent here (negative examples):
${negativeExamples}

Edge cases that ultimately belonged:
${edgeCases}

---

New input to validate:
"${input}"

Does this input belong to this route? Consider:
- Does this match the *intent* of items here, not just surface similarity?
- Does the matcher that fired make sense for this input?
- Is there anything "off" that suggests this is a different kind of thing?

Note: the same input may be entered with many different strings.
Your job is to discern different *intent*.

Same intent, different strings:
- "later today: do xyz"
- "do xyz this evening"

Different intent, similar strings:
- "gwen height 32""
- "jump height 30""

Think through your reasoning, then end with your conclusion.

End your response with: conclusion: <level>

Where <level> is one of:
- certain: unambiguously belongs here
- confident: very likely belongs, minor differences
- plausible: could belong, something slightly off
- unsure: genuinely ambiguous
- doubtful: probably doesn't belong
- reject: definitely wrong route`;
  }

  /**
   * Validate an input against a route.
   * Returns the validation result along with the prompt used.
   */
  async validate(context: ValidationContext): Promise<{
    result: ValidationResult;
    promptUsed: string;
  }> {
    const prompt = this.buildPrompt(context);
    const model = context.route.validation?.model === 'sonnet'
      ? 'claude-sonnet-4-20250514'
      : 'claude-haiku-4-20250514';

    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return {
          result: {
            confidence: 'unsure',
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
          confidence: 'unsure',
          reasoning: `API error: ${error instanceof Error ? error.message : String(error)}`,
        },
        promptUsed: prompt,
      };
    }
  }

  parseResponse(responseText: string): ValidationResult {
    // Look for "conclusion: <level>" at the end
    const conclusionMatch = responseText.match(/conclusion:\s*(\w+)\s*$/im);

    if (!conclusionMatch) {
      return {
        confidence: 'unsure',
        reasoning: 'No conclusion found in response',
      };
    }

    const level = conclusionMatch[1].toLowerCase() as ValidationConfidence;

    if (!CONFIDENCE_LEVELS.includes(level)) {
      return {
        confidence: 'unsure',
        reasoning: `Invalid confidence level: ${level}`,
      };
    }

    // Extract reasoning (everything before the conclusion)
    const reasoning = responseText
      .replace(/conclusion:\s*\w+\s*$/im, '')
      .trim();

    return {
      confidence: level,
      reasoning,
    };
  }

  /**
   * Determine action based on validation confidence.
   */
  static getAction(confidence: ValidationConfidence): 'execute' | 'execute_flagged' | 'mastermind' | 'mastermind_hygiene' {
    switch (confidence) {
      case 'certain':
      case 'confident':
        return 'execute';
      case 'plausible':
        return 'execute_flagged';
      case 'unsure':
        return 'mastermind';
      case 'doubtful':
      case 'reject':
        return 'mastermind_hygiene';
    }
  }
}
