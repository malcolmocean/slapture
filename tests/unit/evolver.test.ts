import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Evolver, EvolverContext, TieredValidationResult } from '../../src/mastermind/evolver.js';
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

      expect(prompt).toContain('Slapture Mastermind');
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

    it('should include soft-blocked captures with tiered validation context', () => {
      const softBlockedCapture: Capture = {
        id: 'sb1',
        raw: 'gwen memory: old format',
        timestamp: '2026-01-20T10:00:00Z',
        username: 'malcolm',
        parsed: { explicitRoute: null, payload: 'old format', metadata: {} },
        routeProposed: 'route-gwen',
        routeConfidence: 'high',
        routeFinal: 'route-gwen',
        executionTrace: [],
        executionResult: 'success',
        verificationState: 'ai_certain',
        retiredFromTests: false,
        retiredReason: null,
      };

      const context: EvolverContext = {
        newInput: 'gwenmem: new format',
        route: testRoute,
        mastermindReason: 'User using new shorthand',
        tieredValidation: {
          hardBlocked: [],
          softBlocked: [softBlockedCapture],
          freedCaptures: [],
          collisions: [],
        },
      };

      const prompt = evolver.buildPrompt(context);

      expect(prompt).toContain('Soft-Protected Captures');
      expect(prompt).toContain('gwen memory: old format');
      expect(prompt).toContain('ai_certain');
      expect(prompt).toContain('overrideJustifications');
    });

    it('should include freed captures with relative dates', () => {
      const freedCapture: Capture = {
        id: 'fc1',
        raw: 'log pushups: 10',
        timestamp: '2026-01-15T10:00:00Z',
        username: 'malcolm',
        parsed: { explicitRoute: null, payload: '10', metadata: {} },
        routeProposed: 'route-gwen',
        routeConfidence: 'low',
        routeFinal: 'route-gwen',
        executionTrace: [],
        executionResult: 'success',
        verificationState: 'pending',
        retiredFromTests: false,
        retiredReason: null,
      };

      const context: EvolverContext = {
        newInput: 'gwenmem: new format',
        route: testRoute,
        mastermindReason: 'User using new shorthand',
        tieredValidation: {
          hardBlocked: [],
          softBlocked: [],
          freedCaptures: [freedCapture],
          collisions: [],
        },
      };

      const prompt = evolver.buildPrompt(context);

      expect(prompt).toContain('Freed Captures');
      expect(prompt).toContain('log pushups: 10');
      expect(prompt).toContain('pending');
      expect(prompt).toContain('RE_ROUTE');
      expect(prompt).toContain('MARK_FOR_REVIEW');
      expect(prompt).toContain('LEAVE_AS_HISTORICAL');
      expect(prompt).toContain('freedCaptureActions');
    });

    it('should include collision errors in prompt', () => {
      const context: EvolverContext = {
        newInput: 'gwenmem: new format',
        route: testRoute,
        mastermindReason: 'User using new shorthand',
        tieredValidation: {
          hardBlocked: [],
          softBlocked: [],
          freedCaptures: [],
          collisions: ['Collision: "weight 80kg" (belongs to weight) would match this route'],
        },
      };

      const prompt = evolver.buildPrompt(context);

      expect(prompt).toContain('COLLISION ERRORS');
      expect(prompt).toContain('weight 80kg');
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

    it('should parse overrideJustifications from response', () => {
      const response = JSON.stringify({
        triggers: [{ type: 'regex', pattern: '^gwenmem', priority: 10 }],
        reasoning: 'New shorthand pattern',
        overrideJustifications: {
          '1': 'This capture was incorrectly routed - contains pushups data',
        },
      });

      const result = evolver.parseResponse(response);

      expect(result.action).toBe('evolved');
      expect(result.overrideJustifications).toBeDefined();
      expect(result.overrideJustifications!['1']).toContain('pushups');
    });

    it('should parse freedCaptureActions from response', () => {
      const response = JSON.stringify({
        triggers: [{ type: 'regex', pattern: '^gwenmem', priority: 10 }],
        reasoning: 'New shorthand pattern',
        freedCaptureActions: {
          '1': {
            action: 'RE_ROUTE',
            suggestedRoute: 'fitness_log',
            reasoning: 'Contains fitness data',
          },
          '2': {
            action: 'LEAVE_AS_HISTORICAL',
            reasoning: 'Old format, no longer relevant',
          },
        },
      });

      const result = evolver.parseResponse(response);

      expect(result.action).toBe('evolved');
      expect(result.freedCaptureActions).toBeDefined();
      expect(result.freedCaptureActions!['1'].action).toBe('RE_ROUTE');
      expect(result.freedCaptureActions!['1'].suggestedRoute).toBe('fitness_log');
      expect(result.freedCaptureActions!['2'].action).toBe('LEAVE_AS_HISTORICAL');
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
        username: 'malcolm',
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
        username: 'malcolm',
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

  describe('tiered validation', () => {
    const allRoutes: Route[] = [
      testRoute,
      {
        id: 'route-fitness',
        name: 'fitness',
        description: 'Log fitness data',
        triggers: [{ type: 'regex', pattern: '^pushups\\s+', priority: 10 }],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: 'fitness.csv' },
        transformScript: null,
        createdAt: '2026-01-22T04:00:00Z',
        createdBy: 'mastermind',
        lastUsed: null,
      },
    ];

    // Build captures with different verification states
    const humanVerifiedCapture: Capture = {
      id: 'hv1',
      raw: 'gwen memory: first steps',
      timestamp: '2025-12-20T10:00:00Z',
      username: 'malcolm',
      parsed: { explicitRoute: null, payload: 'first steps', metadata: {} },
      routeProposed: 'route-gwen',
      routeConfidence: 'high',
      routeFinal: 'route-gwen',
      executionTrace: [],
      executionResult: 'success',
      verificationState: 'human_verified',
      retiredFromTests: false,
      retiredReason: null,
    };

    const aiCertainCapture: Capture = {
      id: 'ac1',
      raw: 'gwen memory: you said milk',
      timestamp: '2026-01-22T10:00:00Z',
      username: 'malcolm',
      parsed: { explicitRoute: null, payload: 'you said milk', metadata: {} },
      routeProposed: 'route-gwen',
      routeConfidence: 'high',
      routeFinal: 'route-gwen',
      executionTrace: [],
      executionResult: 'success',
      verificationState: 'ai_certain',
      retiredFromTests: false,
      retiredReason: null,
    };

    const unverifiedCapture: Capture = {
      id: 'uv1',
      raw: 'log pushups to gwen_memories: 10',  // Mis-routed!
      timestamp: '2026-01-15T10:00:00Z',
      username: 'malcolm',
      parsed: { explicitRoute: null, payload: '10', metadata: {} },
      routeProposed: 'route-gwen',
      routeConfidence: 'low',
      routeFinal: 'route-gwen',
      executionTrace: [],
      executionResult: 'success',
      verificationState: 'pending',
      retiredFromTests: false,
      retiredReason: null,
    };

    const retiredCapture: Capture = {
      id: 'rt1',
      raw: 'old gwen memory format',
      timestamp: '2025-01-01T10:00:00Z',
      username: 'malcolm',
      parsed: { explicitRoute: null, payload: 'old format', metadata: {} },
      routeProposed: 'route-gwen',
      routeConfidence: 'high',
      routeFinal: 'route-gwen',
      executionTrace: [],
      executionResult: 'success',
      verificationState: 'human_verified',
      retiredFromTests: true,
      retiredReason: 'Pattern no longer used',
    };

    it('should exclude retired captures from regression checks entirely', () => {
      const proposedTriggers: RouteTrigger[] = [
        { type: 'regex', pattern: '^gwenmem[:\\s]', priority: 10 },  // Won't match old format
      ];

      // Only the retired capture is routed to gwen - it should be excluded
      const result = evolver.validateChangesTiered(
        proposedTriggers,
        'route-gwen',
        [retiredCapture],
        allRoutes
      );

      // Retired captures don't block anything
      expect(result.hardBlocked).toHaveLength(0);
      expect(result.softBlocked).toHaveLength(0);
      expect(result.freedCaptures).toHaveLength(0);
    });

    it('should categorize human_verified captures as hardBlocked', () => {
      const proposedTriggers: RouteTrigger[] = [
        { type: 'regex', pattern: '^gwenmem[:\\s]', priority: 10 },  // Won't match "gwen memory:"
      ];

      const result = evolver.validateChangesTiered(
        proposedTriggers,
        'route-gwen',
        [humanVerifiedCapture],
        allRoutes
      );

      expect(result.hardBlocked).toHaveLength(1);
      expect(result.hardBlocked[0].id).toBe('hv1');
      expect(result.softBlocked).toHaveLength(0);
      expect(result.freedCaptures).toHaveLength(0);
    });

    it('should categorize ai_certain captures as softBlocked', () => {
      const proposedTriggers: RouteTrigger[] = [
        { type: 'regex', pattern: '^gwenmem[:\\s]', priority: 10 },  // Won't match "gwen memory:"
      ];

      const result = evolver.validateChangesTiered(
        proposedTriggers,
        'route-gwen',
        [aiCertainCapture],
        allRoutes
      );

      expect(result.hardBlocked).toHaveLength(0);
      expect(result.softBlocked).toHaveLength(1);
      expect(result.softBlocked[0].id).toBe('ac1');
      expect(result.freedCaptures).toHaveLength(0);
    });

    it('should categorize unverified captures as freedCaptures', () => {
      const proposedTriggers: RouteTrigger[] = [
        { type: 'regex', pattern: '^gwenmem[:\\s]', priority: 10 },  // Won't match mis-routed pushups
      ];

      const result = evolver.validateChangesTiered(
        proposedTriggers,
        'route-gwen',
        [unverifiedCapture],
        allRoutes
      );

      expect(result.hardBlocked).toHaveLength(0);
      expect(result.softBlocked).toHaveLength(0);
      expect(result.freedCaptures).toHaveLength(1);
      expect(result.freedCaptures[0].id).toBe('uv1');
    });

    it('should still detect collisions regardless of verification state', () => {
      const proposedTriggers: RouteTrigger[] = [
        { type: 'regex', pattern: '.*', priority: 1 },  // Would match everything
      ];

      const fitnessCapture: Capture = {
        id: 'f1',
        raw: 'pushups 20',
        timestamp: '2026-01-22T10:00:00Z',
        username: 'malcolm',
        parsed: { explicitRoute: null, payload: '20', metadata: {} },
        routeProposed: 'route-fitness',
        routeConfidence: 'high',
        routeFinal: 'route-fitness',
        executionTrace: [],
        executionResult: 'success',
        verificationState: 'pending',  // Even unverified
        retiredFromTests: false,
        retiredReason: null,
      };

      const result = evolver.validateChangesTiered(
        proposedTriggers,
        'route-gwen',
        [fitnessCapture],
        allRoutes
      );

      expect(result.collisions).toHaveLength(1);
      expect(result.collisions[0]).toContain('pushups 20');
    });

    it('should correctly categorize mixed verification states', () => {
      const proposedTriggers: RouteTrigger[] = [
        { type: 'regex', pattern: '^gwenmem[:\\s]', priority: 10 },  // Won't match any existing
      ];

      const result = evolver.validateChangesTiered(
        proposedTriggers,
        'route-gwen',
        [humanVerifiedCapture, aiCertainCapture, unverifiedCapture, retiredCapture],
        allRoutes
      );

      // Retired excluded, others categorized by verification state
      expect(result.hardBlocked).toHaveLength(1);
      expect(result.softBlocked).toHaveLength(1);
      expect(result.freedCaptures).toHaveLength(1);
      expect(result.collisions).toHaveLength(0);
    });

    it('should not include captures that still match in any blocked/freed category', () => {
      const proposedTriggers: RouteTrigger[] = [
        { type: 'regex', pattern: '^gwen memory:', priority: 10 },  // Still matches human_verified and ai_certain
      ];

      const result = evolver.validateChangesTiered(
        proposedTriggers,
        'route-gwen',
        [humanVerifiedCapture, aiCertainCapture, unverifiedCapture],
        allRoutes
      );

      // human_verified and ai_certain still match, so not blocked
      expect(result.hardBlocked).toHaveLength(0);
      expect(result.softBlocked).toHaveLength(0);
      // unverified doesn't match, so it's freed
      expect(result.freedCaptures).toHaveLength(1);
    });
  });
});
