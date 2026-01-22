import Anthropic from '@anthropic-ai/sdk';
import { Route, ParseResult, MastermindAction } from '../types.js';

export class Mastermind {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  buildPrompt(
    routes: Route[],
    raw: string,
    parsed: ParseResult,
    dispatcherReason: string
  ): string {
    const routeDescriptions = routes
      .map(r => {
        const triggers = r.triggers
          .map(t => `${t.type}:${t.pattern}`)
          .join(', ');
        const recentExamples = r.recentItems
          .slice(0, 3)
          .map(item => `  - "${item.raw}"`)
          .join('\n');
        return `- **${r.name}**: ${r.description}
  Triggers: ${triggers}
  ${recentExamples ? `Recent:\n${recentExamples}` : ''}`;
      })
      .join('\n\n');

    return `You are the Slapture Mastermind. You handle captures that couldn't be automatically routed.

Current routes:
${routeDescriptions || '(No routes defined yet)'}

Capture to process:
- Raw: "${raw}"
- Parsed payload: "${parsed.payload}"
- Metadata: ${JSON.stringify(parsed.metadata)}
- Dispatcher result: ${dispatcherReason}

Your options:
1. Route to existing: {"action": "route", "routeId": "...", "reason": "..."}
2. Create new route: {"action": "create", "route": {name, description, triggers: [{type, pattern, priority}], destinationType: "fs", destinationConfig: {filePath}, transformScript, schema, createdBy: "mastermind"}, "reason": "..."}
3. Need clarification: {"action": "clarify", "question": "...", "reason": "..."}
4. Send to inbox: {"action": "inbox", "reason": "..."}

For transformScript, you have access to: fs (sandboxed), payload, filePath, timestamp, metadata.
Relative file paths in transformScript are resolved within the user's filestore directory.
Common patterns:
- Append text: fs.appendFileSync(filePath, payload + '\\n')
- JSON map: read, parse, update, write back
- CSV append: fs.appendFileSync('filename.csv', timestamp.split('T')[0] + ',' + message + '\\n')

When creating routes for "log X to Y" patterns:
1. Extract the filename (e.g., "gwen_memories.csv")
2. Create a natural shorthand trigger from the filename (e.g., "gwen memory" from "gwen_memories")
3. Include BOTH "log" prefix trigger AND the shorthand in the triggers array
4. Use relative filenames in transformScript - they resolve within the user directory
5. Route names should be descriptive: use the filename without extension (e.g., "gwen_memories" not "route-123")

For CSV files, include date as first column. For log files, prefix each line with date.

Consider alternative interpretations. Only reject alternatives that are clearly absurd.
If the input is ambiguous between reasonable interpretations, choose "clarify".

Respond with JSON only.`;
  }

  async consult(
    routes: Route[],
    raw: string,
    parsed: ParseResult,
    dispatcherReason: string
  ): Promise<MastermindAction> {
    const prompt = this.buildPrompt(routes, raw, parsed, dispatcherReason);

    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return {
          action: 'inbox',
          reason: 'Unexpected response type from API',
        };
      }

      return this.parseResponse(content.text);
    } catch (error) {
      return {
        action: 'inbox',
        reason: `API error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  parseResponse(responseText: string): MastermindAction {
    try {
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          action: 'inbox',
          reason: `Failed to parse response: no JSON found`,
        };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!parsed.action || !['route', 'create', 'clarify', 'inbox'].includes(parsed.action)) {
        return {
          action: 'inbox',
          reason: `Invalid action in response: ${parsed.action}`,
        };
      }

      return parsed as MastermindAction;
    } catch (error) {
      return {
        action: 'inbox',
        reason: `Failed to parse response: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
