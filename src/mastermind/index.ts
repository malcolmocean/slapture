import Anthropic from '@anthropic-ai/sdk';
import { Route, ParseResult, MastermindAction } from '../types.js';
import type { IntegrationWithStatus } from '../integrations/registry.js';

export interface IntegrationContext {
  integrations: IntegrationWithStatus[];
  integrationNotes: Map<string, string>;  // integrationId -> note content
  destinationNotes: Map<string, string>;  // destinationId -> note content
}

export class Mastermind {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Format auth status for display in prompt
   */
  private formatAuthStatus(integration: IntegrationWithStatus): string {
    if (integration.authType === 'none') {
      return '[no auth needed]';
    }
    switch (integration.status) {
      case 'connected':
        return '[connected]';
      case 'expired':
        return '[auth expired]';
      case 'not-connected':
        return '[not connected]';
      default:
        return '';
    }
  }

  /**
   * Build the integration context section for the prompt
   */
  private buildIntegrationSection(context: IntegrationContext): string {
    const integrationLines = context.integrations.map(i => {
      const status = this.formatAuthStatus(i);
      return `- ${i.name}: ${i.purpose} ${status}`;
    });

    let section = `Available Integrations:
${integrationLines.join('\n')}`;

    // Add user notes if any exist
    const notesEntries = Array.from(context.integrationNotes.entries())
      .filter(([_, note]) => note && note.trim());

    if (notesEntries.length > 0) {
      const noteLines = notesEntries.map(([integrationId, note]) => {
        // Find the integration name for this ID
        const integration = context.integrations.find(i => i.id === integrationId);
        const name = integration?.name || integrationId;
        return `- ${name}: "${note}"`;
      });

      section += `

Your notes on integrations:
${noteLines.join('\n')}`;
    }

    section += `

When creating routes, consider which integration best fits the user's intent.
The "notes" integration lets users save context about other integrations/destinations.`;

    return section;
  }

  buildPrompt(
    routes: Route[],
    raw: string,
    parsed: ParseResult,
    dispatcherReason: string,
    integrationContext?: IntegrationContext
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

        // Include destination note if available
        let destinationNote = '';
        if (integrationContext?.destinationNotes) {
          // Use route name or destinationConfig as destination ID
          const destId = r.name;
          const note = integrationContext.destinationNotes.get(destId);
          if (note) {
            destinationNote = `\n  User note: "${note}"`;
          }
        }

        return `- **${r.name}**: ${r.description}
  Triggers: ${triggers}
  ${recentExamples ? `Recent:\n${recentExamples}` : ''}${destinationNote}`;
      })
      .join('\n\n');

    // Build integration section if context provided
    const integrationSection = integrationContext
      ? `\n${this.buildIntegrationSection(integrationContext)}\n`
      : '';

    return `You are the Slapture Mastermind. You handle captures that couldn't be automatically routed.
${integrationSection}
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
2. Create specific regex triggers that match the intent (e.g., /gwen\\s?memor(y|ies)/i)
3. Prefer specific patterns over broad ones - avoid overly permissive regexes
4. Use relative filenames in transformScript - they resolve within the user directory
5. Route names should be descriptive: use the filename without extension (e.g., "gwen_memories" not "route-123")

Trigger types: Only "regex" is supported. Use regex patterns like:
- /^pattern\\b/i for prefix-like matching
- /pattern/i for substring matching (use sparingly - can be too broad)

For CSV files, include date as first column. For log files, prefix each line with date.

Consider alternative interpretations. Only reject alternatives that are clearly absurd.
If the input is ambiguous between reasonable interpretations, choose "clarify".

Respond with JSON only.`;
  }

  /**
   * Consult the Mastermind about routing a capture.
   * Returns the action along with the prompt used for retroactive replay.
   */
  async consult(
    routes: Route[],
    raw: string,
    parsed: ParseResult,
    dispatcherReason: string,
    integrationContext?: IntegrationContext
  ): Promise<{ action: MastermindAction; promptUsed: string }> {
    const prompt = this.buildPrompt(routes, raw, parsed, dispatcherReason, integrationContext);

    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return {
          action: {
            action: 'inbox',
            reason: 'Unexpected response type from API',
          },
          promptUsed: prompt,
        };
      }

      return {
        action: this.parseResponse(content.text),
        promptUsed: prompt,
      };
    } catch (error) {
      return {
        action: {
          action: 'inbox',
          reason: `API error: ${error instanceof Error ? error.message : String(error)}`,
        },
        promptUsed: prompt,
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
