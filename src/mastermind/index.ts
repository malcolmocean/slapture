import Anthropic from '@anthropic-ai/sdk';
import { Route, ParseResult, MastermindAction } from '../types.js';
import type { IntegrationWithStatus } from '../integrations/registry.js';
import { MASTERMIND_PRINCIPLES } from './principles.js';

export interface SheetsContextEntry {
  id: string;
  name: string;
  sheets: Array<{
    name: string;
    headers: string[];
    sampleRow: string[];
  }>;
}

export interface RoamContextEntry {
  graphName: string;
  pages: string[];
}

export interface IntegrationContext {
  integrations: IntegrationWithStatus[];
  integrationNotes: Map<string, string>;  // integrationId -> note content
  destinationNotes: Map<string, string>;  // destinationId -> note content
  sheetsContext?: {
    spreadsheets: SheetsContextEntry[];
  };
  roamContext?: {
    graphs: RoamContextEntry[];
  };
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
      case 'never':
        return '[not connected]';
      case 'unavailable':
        return '[not available in this environment]';
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

    // Add spreadsheet context for connected Sheets integration
    if (context.sheetsContext?.spreadsheets.length) {
      const sheetLines = context.sheetsContext.spreadsheets.map(ss => {
        const tabSummaries = ss.sheets.map(tab => {
          const headerStr = tab.headers.join(' | ');
          const sampleStr = tab.sampleRow.length ? `\n      Sample: ${tab.sampleRow.join(' | ')}` : '';
          return `    Tab "${tab.name}": ${headerStr}${sampleStr}`;
        }).join('\n');
        return `  - "${ss.name}" (id: ${ss.id})\n${tabSummaries}`;
      }).join('\n');

      section += `\n\nYour Google Sheets (recently accessed):\n${sheetLines}`;
    }

    if (context.roamContext?.graphs.length) {
      const roamLines = context.roamContext.graphs.map(g => {
        const pageList = g.pages.slice(0, 50).join(', ');
        const suffix = g.pages.length > 50 ? `, ... (${g.pages.length} total)` : '';
        return `  Graph "${g.graphName}": ${pageList}${suffix}`;
      }).join('\n');
      section += `\n\nYour Roam Research graphs:\n${roamLines}`;
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

    return `${MASTERMIND_PRINCIPLES}

---

## Context: Routing Mode

You are handling a capture that couldn't be automatically routed by triggers.
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
2. Create new route: {"action": "create", "route": {name, description, triggers: [{type: "regex", pattern, priority, status: "draft"}], destinationType, destinationConfig, transformScript, schema, createdBy: "mastermind"}, "reason": "..."}
3. Need clarification: {"action": "clarify", "question": "...", "reason": "..."}
4. Send to inbox: {"action": "inbox", "reason": "..."}

IMPORTANT: New triggers should use status: "draft" (hypothesis). Draft triggers fire but don't auto-execute - they get validated first. After consistent successful fires (typically 2-4), they graduate to "live".

## Route destination types

### "fs" - Local files
destinationConfig: {filePath: "filename.csv"}
transformScript has access to: fs (sandboxed), payload, filePath, timestamp, metadata.
Relative file paths resolve within the user's filestore directory.
Common patterns:
- Append text: fs.appendFileSync(filePath, payload + '\\n')
- JSON map: read, parse, update, write back
- CSV append: fs.appendFileSync('filename.csv', timestamp.split('T')[0] + ',' + message + '\\n')

### "intend" - intend.do intentions
destinationConfig: {} (no config needed — the executor handles OAuth and API calls)
No transformScript needed — the intend executor posts the payload directly to the intend.do API.

IMPORTANT: The payload is sent as the "raw" field to intend.do's API, which parses it with this regex:
  /^([^\\d\\sA-Za-z)]{0,3})((?:\\d|[A-Z]{2})?(?:,(?:\\d|[A-Z]{2}))*)([^\\d\\sA-Z)]{0,3})(\\)+|\\/\\/)[\\s]+(.*)/u

Broken down:
  _c       = extras before goal code (usually blank, '&' for misc)
  gids     = goal code(s): single digit 0-9, two uppercase letters (e.g. FI), empty, or comma-separated (e.g. "1,FI,3")
  c_       = extras after goal code (usually blank, '*' → starred)
  delimiter = ')' for task, '//' for comment
  t        = the intention text

Examples of valid raw strings:
  "1) do laundry"         → goal 1
  "FI) run 5k"            → goal FI
  "1,FI) run then rest"   → goals 1 and FI
  "&) random task"         → misc/ungrouped
  ") just a task"          → no goal
  "// this is a comment"   → comment

When routing to intend, the payload MUST already be in this format (with goal code + delimiter + text).
The executor sends it directly — it does NOT wrap it.

### "notes" - Save notes about integrations or destinations
destinationConfig: {target: "integration" | "destination", id: "<integrationId or routeName>"}
No transformScript needed - the notes executor handles storage.
Use target "integration" when the note is ABOUT an integration (e.g., "intend", "sheets", "fs").
Use target "destination" when the note is ABOUT a specific route/destination.
The "id" field is the integration ID (e.g., "intend") or the route name (e.g., "gwen_memories").

### "sheets" - Google Sheets
destinationConfig: {spreadsheetId: "<id from spreadsheet list>", spreadsheetName: "<human-readable name>", sheetName: "<tab name>", operation: <operation>}
No transformScript needed - the sheets executor handles everything declaratively.

Operations:
- append_row: Add a new row. Specify columns array.
  operation: {type: "append_row", columns: [<ColumnSpec>, ...]}
- lookup_set_cell: 2D lookup (find row + find column) then set cell value.
  operation: {type: "lookup_set_cell", rowLookup: <LookupSpec>, colLookup: <LookupSpec>, value: <ValueSpec>}
- lookup_append_to_row: Find row, write to first empty column in range.
  operation: {type: "lookup_append_to_row", rowLookup: <LookupSpec>, colRange: [start, end], value: <ValueSpec>}

ColumnSpec / ValueSpec types:
- {type: "today", format?: "short"} — current date
- {type: "payload"} — full parsed payload
- {type: "extract", pattern: "<regex>", group?: 1} — regex capture from payload
- {type: "computed", expression: "<arithmetic>"} — safe math eval
- {type: "literal", value: <any>} — static value

LookupSpec: {axis: "row"|"col", at: <index>, valueSource: <ValueSpec>, match: "exact"|"fuzzy"|"date", range?: [start, end]}

Prefer Google Sheets over local CSV files when the user has Sheets connected and the data is tabular/structured.
Use spreadsheet IDs from the "Your Google Sheets" list when a matching spreadsheet already exists.
Inspect headers to determine the right operation and column mapping.

### "roam" - Roam Research
destinationConfig: {graphName: "<graph name from list>", operation: <operation>}
No transformScript needed — the Roam executor handles everything.

Operations:
- daily_tagged: Write to today's daily page under a tag.
  operation: {type: "daily_tagged", tag: "<tag name>"}
  Creates: #tag as child of today's page, then capture text as child of tag block.
  If #tag already exists on today's page, appends as sibling of existing entries.
  Use for: daily logging, journal-style entries, anything time-organized.

- page_child: Append as child of a named page.
  operation: {type: "page_child", pageTitle: "<page title>"}
  Creates the page if it doesn't exist.
  Use for: lists, collections, reference material that lives on its own page.

graphName is set at the destinationConfig level (not inside operation).
When choosing a graph, look at which graph contains matching pages in the list above.
Daily page UIDs are deterministic — no lookup needed.
Fuzzy-match page names (singular/plural, with/without hash/brackets).
The capture payload should include [[page refs]] where you identify existing pages that are referenced (e.g. person names, topics).

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

  /**
   * Evaluate whether a draft matcher should graduate to live.
   * Called when a draft matcher fires with enough history.
   */
  async evaluateGraduation(
    route: Route,
    trigger: Route['triggers'][0],
    recentFires: Array<{ input: string; timestamp: string }>
  ): Promise<{ shouldGraduate: boolean; reason: string }> {
    // Quick heuristics before calling LLM
    const fireCount = trigger.fireCount ?? 0;
    if (fireCount < 2) {
      return { shouldGraduate: false, reason: 'Not enough fires yet (need at least 2)' };
    }

    // Build prompt for graduation evaluation
    const prompt = `You are evaluating whether a draft trigger should be promoted to "live" status.

Route: ${route.name}
Description: ${route.description}
Trigger pattern: /${trigger.pattern}/i

This trigger has fired ${fireCount} times. Recent inputs that matched:
${recentFires.slice(0, 5).map(f => `- "${f.input}"`).join('\n')}

Should this trigger be graduated to "live" (auto-execute without validation)?

Consider:
1. Are these inputs consistent in their intent?
2. Is the pattern specific enough to avoid false positives?
3. Would you be confident routing similar future inputs automatically?

Respond with JSON:
{"graduate": true/false, "reason": "..."}`;

    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return { shouldGraduate: false, reason: 'Unexpected response type' };
      }

      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { shouldGraduate: false, reason: 'No JSON in response' };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        shouldGraduate: !!parsed.graduate,
        reason: parsed.reason || 'No reason provided',
      };
    } catch (error) {
      return {
        shouldGraduate: false,
        reason: `Error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
