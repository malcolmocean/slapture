import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mastermind } from '../../src/mastermind/index.js';
import { Route, ParseResult, MastermindAction } from '../../src/types.js';

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
});
