import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mastermind, IntegrationContext } from '../../src/mastermind/index.js';
import { Route, ParseResult, MastermindAction } from '../../src/types.js';
import type { IntegrationWithStatus } from '../../src/integrations/registry.js';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn(),
    };
  },
}));

describe('Mastermind', () => {
  let mastermind: Mastermind;
  const existingRoutes: Route[] = [
    {
      id: 'route-dump',
      name: 'dump',
      description: 'Dump text to file',
      triggers: [{ type: 'prefix', pattern: 'dump', priority: 10 }],
      schema: null,
      recentItems: [],
      destinationType: 'fs',
      destinationConfig: { filePath: 'dump.txt' },
      transformScript: "fs.appendFileSync(filePath, payload + '\\n')",
      createdAt: '2026-01-21T12:00:00Z',
      createdBy: 'user',
      lastUsed: null,
    },
  ];

  beforeEach(() => {
    mastermind = new Mastermind('test-api-key');
  });

  describe('prompt building', () => {
    it('should build correct prompt structure', () => {
      const parsed: ParseResult = {
        explicitRoute: null,
        payload: 'weight 88.2kg',
        metadata: { detectedType: 'measurement' },
      };

      const prompt = mastermind.buildPrompt(
        existingRoutes,
        'weight 88.2kg',
        parsed,
        'No matching triggers found'
      );

      expect(prompt).toContain('You are the Slapture Mastermind');
      expect(prompt).toContain('dump');
      expect(prompt).toContain('weight 88.2kg');
      expect(prompt).toContain('No matching triggers found');
    });
  });

  describe('response parsing', () => {
    it('should parse route action', () => {
      const response = JSON.stringify({
        action: 'route',
        routeId: 'route-dump',
        reason: 'This fits the dump route',
      });

      const action = mastermind.parseResponse(response);

      expect(action.action).toBe('route');
      expect(action.routeId).toBe('route-dump');
    });

    it('should parse create action with new route', () => {
      const response = JSON.stringify({
        action: 'create',
        route: {
          name: 'weightlog',
          description: 'Log weight measurements',
          triggers: [
            { type: 'regex', pattern: '^weight\\s+[\\d.]+\\s*(kg|lbs?)?$', priority: 5 },
          ],
          destinationType: 'fs',
          destinationConfig: { filePath: 'weight.csv' },
          transformScript: `
            let lines = [];
            if (fs.existsSync(filePath)) {
              lines = fs.readFileSync(filePath, 'utf-8').trim().split('\\n');
            }
            const match = payload.match(/([\\d.]+)\\s*(kg|lbs?)?/i);
            const value = match[1];
            const unit = match[2] || 'kg';
            lines.push(\`\${timestamp},\${value},\${unit}\`);
            fs.writeFileSync(filePath, lines.join('\\n') + '\\n');
          `,
          schema: 'weight measurement: number with optional unit',
          createdBy: 'mastermind',
        },
        reason: 'Creating new route for weight tracking',
      });

      const action = mastermind.parseResponse(response);

      expect(action.action).toBe('create');
      expect(action.route?.name).toBe('weightlog');
      expect(action.route?.triggers).toHaveLength(1);
    });

    it('should parse clarify action', () => {
      const response = JSON.stringify({
        action: 'clarify',
        question: 'Is this a weight measurement or are you talking about importance?',
        reason: 'Ambiguous input',
      });

      const action = mastermind.parseResponse(response);

      expect(action.action).toBe('clarify');
      expect(action.question).toContain('weight measurement');
    });

    it('should handle malformed JSON gracefully', () => {
      const action = mastermind.parseResponse('not json at all');

      expect(action.action).toBe('inbox');
      expect(action.reason).toContain('Failed to parse');
    });
  });

  describe('integration context in prompt', () => {
    const parsed: ParseResult = {
      explicitRoute: null,
      payload: 'test message',
      metadata: {},
    };

    it('should include integrations with connected status', () => {
      const integrations: IntegrationWithStatus[] = [
        {
          id: 'intend',
          name: 'intend.do',
          purpose: 'Track daily intentions and goals',
          authType: 'oauth',
          status: 'connected',
        },
      ];

      const context: IntegrationContext = {
        integrations,
        integrationNotes: new Map(),
        destinationNotes: new Map(),
      };

      const prompt = mastermind.buildPrompt(
        existingRoutes,
        'test message',
        parsed,
        'No match',
        context
      );

      expect(prompt).toContain('Available Integrations:');
      expect(prompt).toContain('intend.do: Track daily intentions and goals [connected]');
    });

    it('should include integrations with expired status', () => {
      const integrations: IntegrationWithStatus[] = [
        {
          id: 'intend',
          name: 'intend.do',
          purpose: 'Track daily intentions and goals',
          authType: 'oauth',
          status: 'expired',
        },
      ];

      const context: IntegrationContext = {
        integrations,
        integrationNotes: new Map(),
        destinationNotes: new Map(),
      };

      const prompt = mastermind.buildPrompt(
        existingRoutes,
        'test message',
        parsed,
        'No match',
        context
      );

      expect(prompt).toContain('intend.do: Track daily intentions and goals [auth expired]');
    });

    it('should include integrations with never status', () => {
      const integrations: IntegrationWithStatus[] = [
        {
          id: 'intend',
          name: 'intend.do',
          purpose: 'Track daily intentions and goals',
          authType: 'oauth',
          status: 'never',
        },
      ];

      const context: IntegrationContext = {
        integrations,
        integrationNotes: new Map(),
        destinationNotes: new Map(),
      };

      const prompt = mastermind.buildPrompt(
        existingRoutes,
        'test message',
        parsed,
        'No match',
        context
      );

      expect(prompt).toContain('intend.do: Track daily intentions and goals [not connected]');
    });

    it('should show [no auth needed] for integrations with authType none', () => {
      const integrations: IntegrationWithStatus[] = [
        {
          id: 'fs',
          name: 'Local Files',
          purpose: 'Append to CSV/JSON/txt files',
          authType: 'none',
          status: 'connected',
        },
      ];

      const context: IntegrationContext = {
        integrations,
        integrationNotes: new Map(),
        destinationNotes: new Map(),
      };

      const prompt = mastermind.buildPrompt(
        existingRoutes,
        'test message',
        parsed,
        'No match',
        context
      );

      expect(prompt).toContain('Local Files: Append to CSV/JSON/txt files [no auth needed]');
    });

    it('should include integration notes when present', () => {
      const integrations: IntegrationWithStatus[] = [
        {
          id: 'intend',
          name: 'intend.do',
          purpose: 'Track daily intentions and goals',
          authType: 'oauth',
          status: 'connected',
        },
      ];

      const integrationNotes = new Map<string, string>();
      integrationNotes.set('intend', 'I phrase these as verbs, present tense');

      const context: IntegrationContext = {
        integrations,
        integrationNotes,
        destinationNotes: new Map(),
      };

      const prompt = mastermind.buildPrompt(
        existingRoutes,
        'test message',
        parsed,
        'No match',
        context
      );

      expect(prompt).toContain('Your notes on integrations:');
      expect(prompt).toContain('intend.do: "I phrase these as verbs, present tense"');
    });

    it('should not include notes section if no integration notes exist', () => {
      const integrations: IntegrationWithStatus[] = [
        {
          id: 'intend',
          name: 'intend.do',
          purpose: 'Track daily intentions and goals',
          authType: 'oauth',
          status: 'connected',
        },
      ];

      const context: IntegrationContext = {
        integrations,
        integrationNotes: new Map(),
        destinationNotes: new Map(),
      };

      const prompt = mastermind.buildPrompt(
        existingRoutes,
        'test message',
        parsed,
        'No match',
        context
      );

      expect(prompt).not.toContain('Your notes on integrations:');
    });

    it('should include destination notes for routes', () => {
      const integrations: IntegrationWithStatus[] = [];

      const destinationNotes = new Map<string, string>();
      destinationNotes.set('dump', 'This is for random thoughts');

      const context: IntegrationContext = {
        integrations,
        integrationNotes: new Map(),
        destinationNotes,
      };

      const prompt = mastermind.buildPrompt(
        existingRoutes,
        'test message',
        parsed,
        'No match',
        context
      );

      expect(prompt).toContain('User note: "This is for random thoughts"');
    });

    it('should include guidance about notes integration', () => {
      const integrations: IntegrationWithStatus[] = [
        {
          id: 'notes',
          name: 'Notes',
          purpose: 'Save notes about integrations and destinations',
          authType: 'none',
          status: 'connected',
        },
      ];

      const context: IntegrationContext = {
        integrations,
        integrationNotes: new Map(),
        destinationNotes: new Map(),
      };

      const prompt = mastermind.buildPrompt(
        existingRoutes,
        'test message',
        parsed,
        'No match',
        context
      );

      expect(prompt).toContain('When creating routes, consider which integration best fits the user\'s intent.');
      expect(prompt).toContain('The "notes" integration lets users save context about other integrations/destinations.');
    });

    it('should include spreadsheet context for connected Sheets integration', () => {
      const integrations: IntegrationWithStatus[] = [
        {
          id: 'sheets',
          name: 'Google Sheets',
          purpose: 'Capture data to Google Sheets',
          authType: 'oauth',
          status: 'connected',
        },
      ];

      const context: IntegrationContext = {
        integrations,
        integrationNotes: new Map(),
        destinationNotes: new Map(),
        sheetsContext: {
          spreadsheets: [
            {
              id: 'abc123',
              name: 'Baby Memories',
              sheets: [
                { name: 'Sheet1', headers: ['Date', 'Memory', 'Who'], sampleRow: ['2026-01-01', 'First smile', 'Gwen'] },
              ],
            },
            {
              id: 'def456',
              name: 'Malcolm Weight',
              sheets: [
                { name: 'Log', headers: ['Date', 'Weight (kg)', 'Notes'], sampleRow: ['2026-03-01', '85.2', ''] },
              ],
            },
          ],
        },
      };

      const prompt = mastermind.buildPrompt(
        existingRoutes,
        'baby smiled today',
        { explicitRoute: null, payload: 'baby smiled today', metadata: {} },
        'No match',
        context
      );

      expect(prompt).toContain('Your Google Sheets (recently accessed)');
      expect(prompt).toContain('Baby Memories');
      expect(prompt).toContain('abc123');
      expect(prompt).toContain('Date | Memory | Who');
      expect(prompt).toContain('Malcolm Weight');
    });

    it('should not include spreadsheet context when Sheets not connected', () => {
      const integrations: IntegrationWithStatus[] = [
        {
          id: 'sheets',
          name: 'Google Sheets',
          purpose: 'Capture data to Google Sheets',
          authType: 'oauth',
          status: 'never',
        },
      ];

      const context: IntegrationContext = {
        integrations,
        integrationNotes: new Map(),
        destinationNotes: new Map(),
      };

      const prompt = mastermind.buildPrompt(
        existingRoutes,
        'test',
        { explicitRoute: null, payload: 'test', metadata: {} },
        'No match',
        context
      );

      expect(prompt).not.toContain('Your Google Sheets (recently accessed)');
    });

    it('should work without integration context (backwards compatible)', () => {
      const prompt = mastermind.buildPrompt(
        existingRoutes,
        'test message',
        parsed,
        'No match'
      );

      expect(prompt).toContain('You are the Slapture Mastermind');
      expect(prompt).toContain('dump');
      expect(prompt).not.toContain('Available Integrations:');
    });
  });

  describe('sheets destination docs in prompt', () => {
    it('should include sheets destination type documentation', () => {
      const prompt = mastermind.buildPrompt(
        [],
        'test',
        { explicitRoute: null, payload: 'test', metadata: {} },
        'No match'
      );

      expect(prompt).toContain('### "sheets" - Google Sheets');
      expect(prompt).toContain('spreadsheetId');
      expect(prompt).toContain('append_row');
      expect(prompt).toContain('lookup_set_cell');
      expect(prompt).toContain('lookup_append_to_row');
    });

    it('should instruct Mastermind to prefer Sheets over CSV when Sheets is connected', () => {
      const prompt = mastermind.buildPrompt(
        [],
        'test',
        { explicitRoute: null, payload: 'test', metadata: {} },
        'No match'
      );

      expect(prompt).toContain('Prefer Google Sheets over local CSV');
    });
  });
});
