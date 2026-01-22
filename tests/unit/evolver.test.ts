import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Evolver, EvolverContext } from '../../src/mastermind/evolver.js';
import { Route, Capture, RouteTrigger } from '../../src/types.js';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn(),
    };
  },
}));

describe('Evolver', () => {
  let evolver: Evolver;

  const testRoute: Route = {
    id: 'route-gwen',
    name: 'gwen_memories',
    description: 'Log memories about Gwen',
    triggers: [{ type: 'keyword', pattern: 'gwen memory', priority: 10 }],
    schema: null,
    recentItems: [
      { captureId: 'c1', raw: 'gwen memory: you said milk', timestamp: '2026-01-22T10:00:00Z', wasCorrect: true },
    ],
    destinationType: 'fs',
    destinationConfig: { filePath: 'gwen_memories.csv' },
    transformScript: "fs.appendFileSync(filePath, timestamp.split('T')[0] + ',' + payload + '\\n')",
    createdAt: '2026-01-22T05:00:00Z',
    createdBy: 'mastermind',
    lastUsed: '2026-01-22T10:00:00Z',
  };

  beforeEach(() => {
    evolver = new Evolver('test-api-key');
  });

  describe('prompt building', () => {
    it('should build correct prompt with route context', () => {
      const context: EvolverContext = {
        newInput: 'gwen memories: your hair is curly',
        route: testRoute,
        mastermindReason: 'User said gwen memories (plural), likely meant gwen_memories route',
      };

      const prompt = evolver.buildPrompt(context);

      expect(prompt).toContain('Slapture Evolver');
      expect(prompt).toContain('gwen_memories');
      expect(prompt).toContain('gwen memories: your hair is curly');
      expect(prompt).toContain('gwen memory');
      expect(prompt).toContain('User said gwen memories (plural)');
    });

    it('should include validation failure context on retry', () => {
      const context: EvolverContext = {
        newInput: 'gwen memories: test',
        route: testRoute,
        mastermindReason: 'Plural variant',
        validationFailure: {
          errors: ['Regression: "gwen memory: you said milk" no longer matches'],
          otherRoutesTriggers: [
            { routeName: 'weight', triggers: [{ type: 'regex', pattern: '^weight\\s+', priority: 10 }] },
          ],
        },
      };

      const prompt = evolver.buildPrompt(context);

      expect(prompt).toContain('VALIDATION FAILED');
      expect(prompt).toContain('Regression');
      expect(prompt).toContain('no longer matches');
      expect(prompt).toContain('weight');
    });
  });

  describe('response parsing', () => {
    it('should parse evolved triggers response', () => {
      const response = JSON.stringify({
        triggers: [
          { type: 'regex', pattern: '^gwen memor(y|ies):', priority: 10 },
        ],
        reasoning: 'Added regex to handle singular/plural',
      });

      const result = evolver.parseResponse(response);

      expect(result.action).toBe('evolved');
      expect(result.triggers).toHaveLength(1);
      expect(result.triggers![0].pattern).toBe('^gwen memor(y|ies):');
      expect(result.reasoning).toContain('singular/plural');
    });

    it('should parse evolved transform response', () => {
      const response = JSON.stringify({
        transform: 'let val = parseFloat(payload); if (val > 140) val /= 2.205;',
        reasoning: 'Added unit conversion for lbs',
      });

      const result = evolver.parseResponse(response);

      expect(result.action).toBe('evolved');
      expect(result.transform).toContain('140');
      expect(result.reasoning).toContain('unit conversion');
    });

    it('should parse skip response', () => {
      const response = JSON.stringify({
        action: 'skip',
        reasoning: 'Input appears to be a typo, not worth capturing',
      });

      const result = evolver.parseResponse(response);

      expect(result.action).toBe('skipped');
      expect(result.reasoning).toContain('typo');
    });

    it('should handle malformed JSON', () => {
      const result = evolver.parseResponse('not json');

      expect(result.action).toBe('failed');
      expect(result.reasoning).toContain('No JSON found');
    });

    it('should handle missing triggers/transform/skip', () => {
      const response = JSON.stringify({
        reasoning: 'Just a reason, no action',
      });

      const result = evolver.parseResponse(response);

      expect(result.action).toBe('failed');
      expect(result.reasoning).toContain('Invalid response');
    });
  });

  describe('validation', () => {
    const allRoutes: Route[] = [
      testRoute,
      {
        id: 'route-weight',
        name: 'weight',
        description: 'Log weight',
        triggers: [{ type: 'regex', pattern: '^weight\\s+[\\d.]+', priority: 10 }],
        schema: null,
        recentItems: [
          { captureId: 'w1', raw: 'weight 88.2kg', timestamp: '2026-01-22T09:00:00Z', wasCorrect: true },
        ],
        destinationType: 'fs',
        destinationConfig: { filePath: 'weight.csv' },
        transformScript: null,
        createdAt: '2026-01-22T04:00:00Z',
        createdBy: 'mastermind',
        lastUsed: '2026-01-22T09:00:00Z',
      },
    ];

    const allCaptures: Capture[] = [
      {
        id: 'c1',
        raw: 'gwen memory: you said milk',
        timestamp: '2026-01-22T10:00:00Z',
        parsed: { explicitRoute: null, payload: 'you said milk', metadata: {} },
        routeProposed: 'route-gwen',
        routeConfidence: 'high',
        routeFinal: 'route-gwen',
        executionTrace: [],
        executionResult: 'success',
        verificationState: 'ai_certain',
        retiredFromTests: false,
        retiredReason: null,
      },
      {
        id: 'w1',
        raw: 'weight 88.2kg',
        timestamp: '2026-01-22T09:00:00Z',
        parsed: { explicitRoute: null, payload: '88.2kg', metadata: {} },
        routeProposed: 'route-weight',
        routeConfidence: 'high',
        routeFinal: 'route-weight',
        executionTrace: [],
        executionResult: 'success',
        verificationState: 'ai_certain',
        retiredFromTests: false,
        retiredReason: null,
      },
    ];

    it('should pass validation when triggers still match existing captures', () => {
      const proposedTriggers: RouteTrigger[] = [
        { type: 'regex', pattern: '^gwen memor(y|ies):', priority: 10 },
      ];

      const result = evolver.validateChanges(
        proposedTriggers,
        'route-gwen',
        allCaptures,
        allRoutes
      );

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation on regression (existing capture no longer matches)', () => {
      const proposedTriggers: RouteTrigger[] = [
        { type: 'keyword', pattern: 'gwen memories', priority: 10 }, // Won't match "gwen memory:"
      ];

      const result = evolver.validateChanges(
        proposedTriggers,
        'route-gwen',
        allCaptures,
        allRoutes
      );

      expect(result.passed).toBe(false);
      expect(result.errors.some(e => e.includes('Regression'))).toBe(true);
    });

    it('should fail validation on collision (would match another route\'s capture)', () => {
      const proposedTriggers: RouteTrigger[] = [
        { type: 'keyword', pattern: 'gwen memory', priority: 10 },
        { type: 'regex', pattern: '.*', priority: 1 }, // Would match everything including weight
      ];

      const result = evolver.validateChanges(
        proposedTriggers,
        'route-gwen',
        allCaptures,
        allRoutes
      );

      expect(result.passed).toBe(false);
      expect(result.errors.some(e => e.includes('Collision'))).toBe(true);
    });
  });
});
