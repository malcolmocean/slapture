// tests/validation/llm-validation.test.ts
//
// LLM validation test suite for Phase 4.
// Tests run at normal temperature with 3/3 agreement requirement.
//
// These tests make real API calls and should be run separately:
//   pnpm test:validation
//
// Each test case runs 3 times and requires all 3 to agree.

import { describe, it, expect, beforeAll } from 'vitest';
import { Validator, ValidationContext } from '../../src/validation/index.js';
import { Route, RouteTrigger, ValidationConfidence } from '../../src/types.js';

// Skip if no API key (for CI)
const API_KEY = process.env.ANTHROPIC_API_KEY;
const RUN_LLM_TESTS = !!API_KEY;

// Helper to create a test route
function createTestRoute(overrides: Partial<Route> = {}): Route {
  return {
    id: 'test-route',
    name: 'test',
    description: 'Test route',
    triggers: [],
    schema: null,
    recentItems: [],
    destinationType: 'fs',
    destinationConfig: { filePath: 'test.txt' },
    transformScript: null,
    createdAt: new Date().toISOString(),
    createdBy: 'user',
    lastUsed: null,
    ...overrides,
  };
}

// Helper to create a test trigger
function createTestTrigger(pattern: string, priority = 10): RouteTrigger {
  return {
    type: 'regex',
    pattern,
    priority,
  };
}

// Run validation 3 times and check for agreement
async function runWithAgreement(
  validator: Validator,
  context: ValidationContext,
  expectedLevels: ValidationConfidence[],
  runs = 3
): Promise<{ passed: boolean; results: ValidationConfidence[]; reasoning: string[] }> {
  const results: ValidationConfidence[] = [];
  const reasoning: string[] = [];

  for (let i = 0; i < runs; i++) {
    const { result } = await validator.validate(context);
    results.push(result.confidence);
    reasoning.push(result.reasoning);
  }

  // Check if all results are in expected levels
  const allMatch = results.every(r => expectedLevels.includes(r));
  // Check if all results agree with each other
  const allAgree = results.every(r => r === results[0]);

  return {
    passed: allMatch && allAgree,
    results,
    reasoning,
  };
}

describe.skipIf(!RUN_LLM_TESTS)('LLM Validation Tests', () => {
  let validator: Validator;

  beforeAll(() => {
    validator = new Validator(API_KEY!);
  });

  describe('Test Case 1: Broad matcher catches unrelated input', () => {
    it('should return doubtful/reject for pushups log going to gwen_memories via broad /^log/ matcher', async () => {
      const route = createTestRoute({
        name: 'gwen_memories',
        description: 'Log memories about Gwen with date',
        triggers: [
          createTestTrigger('gwen\\s?memor(y|ies)', 10),
          createTestTrigger('^log', 5), // Too broad!
        ],
        recentItems: [
          { captureId: '1', raw: 'gwen memory: you said milk for the first time', timestamp: '2026-01-20T10:00:00Z', wasCorrect: true },
          { captureId: '2', raw: 'gwenmemory you look so cute with your hair like a who', timestamp: '2026-01-19T10:00:00Z', wasCorrect: true },
          { captureId: '3', raw: "gwen memories: your hair is curlier than artemis's", timestamp: '2026-01-18T10:00:00Z', wasCorrect: true },
          { captureId: '4', raw: "gwen memories: you're so beautiful", timestamp: '2026-01-17T10:00:00Z', wasCorrect: true },
        ],
      });

      const trigger = createTestTrigger('^log', 5);
      const context: ValidationContext = {
        route,
        matchedTrigger: trigger,
        input: 'log today\'s pushups to pushups.csv: 10',
      };

      const { passed, results, reasoning } = await runWithAgreement(
        validator,
        context,
        ['doubtful', 'reject']
      );

      console.log('Test 1 results:', results);
      console.log('Test 1 reasoning:', reasoning[0]?.slice(0, 200));

      expect(passed).toBe(true);
    }, 30000); // 30s timeout for API calls
  });

  describe('Test Case 2: Specific matcher catches correct input', () => {
    it('should return certain/confident for matching gwen memory input', async () => {
      const route = createTestRoute({
        name: 'gwen_memories',
        description: 'Log memories about Gwen with date',
        triggers: [
          createTestTrigger('gwen\\s?memor(y|ies)', 10),
        ],
        recentItems: [
          { captureId: '1', raw: 'gwen memory: you said milk for the first time', timestamp: '2026-01-20T10:00:00Z', wasCorrect: true },
          { captureId: '2', raw: 'gwenmemory you look so cute with your hair like a who', timestamp: '2026-01-19T10:00:00Z', wasCorrect: true },
        ],
      });

      const trigger = createTestTrigger('gwen\\s?memor(y|ies)', 10);
      const context: ValidationContext = {
        route,
        matchedTrigger: trigger,
        input: 'gwen memories: you love reading the jabberwocky',
      };

      const { passed, results, reasoning } = await runWithAgreement(
        validator,
        context,
        ['certain', 'confident']
      );

      console.log('Test 2 results:', results);
      console.log('Test 2 reasoning:', reasoning[0]?.slice(0, 200));

      expect(passed).toBe(true);
    }, 30000);
  });

  describe('Test Case 3: Semantic rejection despite pattern match', () => {
    it('should return doubtful/reject for package weight going to body weight log', async () => {
      const route = createTestRoute({
        name: 'weightlog',
        description: 'Track body weight measurements',
        triggers: [
          createTestTrigger('weight\\s*\\d', 10),
        ],
        recentItems: [
          { captureId: '1', raw: 'weight 88.2kg', timestamp: '2026-01-20T10:00:00Z', wasCorrect: true },
          { captureId: '2', raw: 'weight 88.1kg', timestamp: '2026-01-19T10:00:00Z', wasCorrect: true },
          { captureId: '3', raw: 'weight 87.9kg', timestamp: '2026-01-18T10:00:00Z', wasCorrect: true },
        ],
      });

      const trigger = createTestTrigger('weight\\s*\\d', 10);
      const context: ValidationContext = {
        route,
        matchedTrigger: trigger,
        input: 'weight 2kg package arrived',
      };

      const { passed, results, reasoning } = await runWithAgreement(
        validator,
        context,
        ['doubtful', 'reject']
      );

      console.log('Test 3 results:', results);
      console.log('Test 3 reasoning:', reasoning[0]?.slice(0, 200));

      expect(passed).toBe(true);
    }, 30000);
  });

  describe('Test Case 4: Ambiguous input handled appropriately', () => {
    it('should return unsure for baby weight going to body weight log', async () => {
      const route = createTestRoute({
        name: 'weightlog',
        description: 'Track body weight measurements',
        triggers: [
          createTestTrigger('weight', 10),
        ],
        recentItems: [
          { captureId: '1', raw: 'weight 88.2kg', timestamp: '2026-01-20T10:00:00Z', wasCorrect: true },
          { captureId: '2', raw: 'weight 88.1kg', timestamp: '2026-01-19T10:00:00Z', wasCorrect: true },
        ],
      });

      const trigger = createTestTrigger('weight', 10);
      const context: ValidationContext = {
        route,
        matchedTrigger: trigger,
        input: 'baby weight 10.3kg',
      };

      const { passed, results, reasoning } = await runWithAgreement(
        validator,
        context,
        ['unsure', 'plausible', 'doubtful'] // Allow some flexibility for truly ambiguous cases
      );

      console.log('Test 4 results:', results);
      console.log('Test 4 reasoning:', reasoning[0]?.slice(0, 200));

      expect(passed).toBe(true);
    }, 30000);
  });
});

describe('Validator Unit Tests', () => {
  describe('parseResponse', () => {
    let validator: Validator;

    beforeAll(() => {
      // Use dummy key for unit tests
      validator = new Validator('dummy-key');
    });

    it('should parse valid conclusion', () => {
      const response = `
This input clearly matches the route's intent.
The pattern and content are consistent.

conclusion: certain
`;
      const result = validator.parseResponse(response);
      expect(result.confidence).toBe('certain');
      expect(result.reasoning).toContain('clearly matches');
    });

    it('should parse conclusion with different casing', () => {
      const result = validator.parseResponse('reasoning here\n\nConclusion: CONFIDENT');
      expect(result.confidence).toBe('confident');
    });

    it('should return unsure when no conclusion found', () => {
      const result = validator.parseResponse('This is some text without a conclusion');
      expect(result.confidence).toBe('unsure');
      expect(result.reasoning).toContain('No conclusion found');
    });

    it('should return unsure for invalid confidence level', () => {
      const result = validator.parseResponse('conclusion: maybe');
      expect(result.confidence).toBe('unsure');
      expect(result.reasoning).toContain('Invalid confidence level');
    });
  });

  describe('getAction', () => {
    it('should return execute for certain/confident', () => {
      expect(Validator.getAction('certain')).toBe('execute');
      expect(Validator.getAction('confident')).toBe('execute');
    });

    it('should return execute_flagged for plausible', () => {
      expect(Validator.getAction('plausible')).toBe('execute_flagged');
    });

    it('should return mastermind for unsure', () => {
      expect(Validator.getAction('unsure')).toBe('mastermind');
    });

    it('should return mastermind_hygiene for doubtful/reject', () => {
      expect(Validator.getAction('doubtful')).toBe('mastermind_hygiene');
      expect(Validator.getAction('reject')).toBe('mastermind_hygiene');
    });
  });
});
