// tests/unit/evolver-ratchet.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Storage } from '../../src/storage/index.js';
import { createEvolverTestCase, getPromptVersion, EvolverTestCaseInput } from '../../src/mastermind/evolver-ratchet.js';
import { EvolverResult, Route, RouteTrigger } from '../../src/types.js';
import fs from 'fs';

const TEST_DATA_DIR = './test-data-ratchet';

describe('Evolver Ratchet System', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = new Storage(TEST_DATA_DIR);
  });

  afterEach(() => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  describe('createEvolverTestCase', () => {
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
      transformScript: null,
      createdAt: '2026-01-22T05:00:00Z',
      createdBy: 'mastermind',
      lastUsed: '2026-01-22T10:00:00Z',
    };

    it('should create a test case from evolver input and result', () => {
      const input: EvolverTestCaseInput = {
        newInput: 'gwen memories: test',
        route: testRoute,
        mastermindReason: 'User said gwen memories (plural)',
        promptUsed: 'You are the Slapture Evolver...',
      };

      const result: EvolverResult = {
        action: 'skipped',
        reasoning: 'No obvious pattern to add',
      };

      const testCase = createEvolverTestCase(input, result);

      expect(testCase.id).toMatch(/^evtc-/);
      expect(testCase.input.newInput).toBe('gwen memories: test');
      expect(testCase.input.routeId).toBe('route-gwen');
      expect(testCase.input.routeName).toBe('gwen_memories');
      expect(testCase.input.routeTriggers).toEqual(testRoute.triggers);
      expect(testCase.input.routeDescription).toBe('Log memories about Gwen');
      expect(testCase.input.routeRecentItems).toEqual(['gwen memory: you said milk']);
      expect(testCase.input.mastermindReason).toBe('User said gwen memories (plural)');
      expect(testCase.expectedAction).toBe('skip');
      expect(testCase.actualResult).toEqual(result);
      expect(testCase.promptUsed).toBe('You are the Slapture Evolver...');
      expect(testCase.isRatchetCase).toBe(false); // skipped = not ratchet
      expect(testCase.wasRegression).toBe(false);
    });

    it('should mark evolved cases as ratchet cases', () => {
      const input: EvolverTestCaseInput = {
        newInput: 'gwenmemory: test',
        route: testRoute,
        mastermindReason: 'Typo variant',
        promptUsed: 'You are the Slapture Evolver...',
      };

      const result: EvolverResult = {
        action: 'evolved',
        triggers: [{ type: 'regex', pattern: 'gwen\\s*memor(y|ies)', priority: 10 }],
        reasoning: 'Added regex to handle typos',
      };

      const testCase = createEvolverTestCase(input, result);

      expect(testCase.isRatchetCase).toBe(true);
      expect(testCase.expectedAction).toBe('evolved');
      expect(testCase.expectedTriggers).toEqual(result.triggers);
    });

    it('should not mark failed cases as ratchet', () => {
      const input: EvolverTestCaseInput = {
        newInput: 'test input',
        route: testRoute,
        mastermindReason: 'test',
        promptUsed: 'test prompt',
      };

      const result: EvolverResult = {
        action: 'failed',
        reasoning: 'API error',
      };

      const testCase = createEvolverTestCase(input, result);

      expect(testCase.isRatchetCase).toBe(false);
      expect(testCase.expectedAction).toBe('skip'); // Failed treated as skip for expected
    });
  });

  describe('getPromptVersion', () => {
    it('should return consistent hash for same prompt', () => {
      const prompt = 'You are the Slapture Evolver...';
      const v1 = getPromptVersion(prompt);
      const v2 = getPromptVersion(prompt);

      expect(v1).toBe(v2);
      expect(v1).toHaveLength(8); // Short hash
    });

    it('should return different hash for different prompts', () => {
      const v1 = getPromptVersion('prompt version 1');
      const v2 = getPromptVersion('prompt version 2');

      expect(v1).not.toBe(v2);
    });
  });

  describe('integration: save and prune', () => {
    it('should auto-save test case and prune old ones', async () => {
      const testRoute: Route = {
        id: 'route-test',
        name: 'test',
        description: 'Test route',
        triggers: [],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: 'test.txt' },
        transformScript: null,
        createdAt: '2026-01-22T05:00:00Z',
        createdBy: 'user',
        lastUsed: null,
      };

      // Save 7 test cases
      for (let i = 0; i < 7; i++) {
        const input: EvolverTestCaseInput = {
          newInput: `input ${i}`,
          route: testRoute,
          mastermindReason: 'test',
          promptUsed: 'test prompt',
        };
        const result: EvolverResult = {
          action: 'skipped',
          reasoning: 'test',
        };
        const testCase = createEvolverTestCase(input, result);
        // Override timestamp for deterministic ordering
        testCase.timestamp = new Date(Date.now() + i * 1000).toISOString();
        await storage.saveEvolverTestCase(testCase);
      }

      // Prune to 5
      await storage.pruneEvolverTestCases(5);

      const remaining = await storage.listEvolverTestCases();
      expect(remaining).toHaveLength(5);
    });
  });
});
