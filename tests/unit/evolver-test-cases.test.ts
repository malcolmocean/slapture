// tests/unit/evolver-test-cases.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Storage } from '../../src/storage/index.js';
import { EvolverTestCase, Route, RouteTrigger, EvolverResult } from '../../src/types.js';
import fs from 'fs';
import crypto from 'crypto';

const TEST_DATA_DIR = './test-data-evolver';

describe('Evolver Test Cases', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = new Storage(TEST_DATA_DIR);
  });

  afterEach(() => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  describe('auto-save test cases', () => {
    it('should save a test case from evolver context and result', async () => {
      const testCase: EvolverTestCase = {
        id: 'tc-1',
        timestamp: '2026-01-22T10:00:00Z',
        input: {
          newInput: 'gwen memories: test',
          routeId: 'route-gwen',
          routeName: 'gwen_memories',
          routeTriggers: [{ type: 'keyword', pattern: 'gwen memory', priority: 10 }],
          routeDescription: 'Log memories about Gwen',
          routeRecentItems: ['gwen memory: you said milk'],
          mastermindReason: 'User said gwen memories (plural)',
        },
        expectedAction: 'skip',
        actualResult: {
          action: 'skipped',
          reasoning: 'No obvious pattern to add',
        },
        promptUsed: 'You are the Slapture Evolver...',
        promptVersion: 'abc123',
        isRatchetCase: false,
        wasRegression: false,
      };

      await storage.saveEvolverTestCase(testCase);
      const retrieved = await storage.getEvolverTestCase('tc-1');

      expect(retrieved).toEqual(testCase);
    });

    it('should mark evolved cases as ratchet cases', async () => {
      const evolvedCase: EvolverTestCase = {
        id: 'tc-evolved',
        timestamp: '2026-01-22T10:00:00Z',
        input: {
          newInput: 'gwenmemory: test',
          routeId: 'route-gwen',
          routeName: 'gwen_memories',
          routeTriggers: [{ type: 'keyword', pattern: 'gwen memory', priority: 10 }],
          routeDescription: 'Log memories about Gwen',
          routeRecentItems: [],
          mastermindReason: 'Typo variant of gwen memory',
        },
        expectedAction: 'evolved',
        expectedTriggers: [{ type: 'regex', pattern: 'gwen\\s*memor(y|ies)', priority: 10 }],
        actualResult: {
          action: 'evolved',
          triggers: [{ type: 'regex', pattern: 'gwen\\s*memor(y|ies)', priority: 10 }],
          reasoning: 'Added regex to handle typos',
        },
        promptUsed: 'You are the Slapture Evolver...',
        promptVersion: 'abc123',
        isRatchetCase: true, // Evolved = ratchet
        wasRegression: false,
      };

      await storage.saveEvolverTestCase(evolvedCase);
      const cases = await storage.listEvolverTestCases();

      expect(cases.find(c => c.id === 'tc-evolved')?.isRatchetCase).toBe(true);
    });
  });

  describe('pruning', () => {
    it('should keep only last N non-ratchet cases', async () => {
      // Create 7 non-ratchet cases
      for (let i = 0; i < 7; i++) {
        await storage.saveEvolverTestCase({
          id: `tc-${i}`,
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          input: {
            newInput: `input ${i}`,
            routeId: 'route-1',
            routeName: 'test',
            routeTriggers: [],
            routeDescription: 'test',
            routeRecentItems: [],
            mastermindReason: 'test',
          },
          expectedAction: 'skip',
          actualResult: { action: 'skipped', reasoning: 'test' },
          promptUsed: 'test',
          promptVersion: 'v1',
          isRatchetCase: false,
          wasRegression: false,
        });
      }

      await storage.pruneEvolverTestCases(5);
      const remaining = await storage.listEvolverTestCases();

      expect(remaining).toHaveLength(5);
      // Should keep the 5 most recent (tc-2 through tc-6)
      expect(remaining.map(c => c.id).sort()).toEqual(['tc-2', 'tc-3', 'tc-4', 'tc-5', 'tc-6']);
    });

    it('should never delete ratchet cases', async () => {
      // Create 3 ratchet cases
      for (let i = 0; i < 3; i++) {
        await storage.saveEvolverTestCase({
          id: `ratchet-${i}`,
          timestamp: new Date(Date.now() - 100000 + i * 1000).toISOString(), // Old timestamps
          input: {
            newInput: `ratchet input ${i}`,
            routeId: 'route-1',
            routeName: 'test',
            routeTriggers: [],
            routeDescription: 'test',
            routeRecentItems: [],
            mastermindReason: 'test',
          },
          expectedAction: 'evolved',
          actualResult: { action: 'evolved', triggers: [], reasoning: 'test' },
          promptUsed: 'test',
          promptVersion: 'v1',
          isRatchetCase: true,
          wasRegression: false,
        });
      }

      // Create 7 non-ratchet cases
      for (let i = 0; i < 7; i++) {
        await storage.saveEvolverTestCase({
          id: `non-ratchet-${i}`,
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          input: {
            newInput: `input ${i}`,
            routeId: 'route-1',
            routeName: 'test',
            routeTriggers: [],
            routeDescription: 'test',
            routeRecentItems: [],
            mastermindReason: 'test',
          },
          expectedAction: 'skip',
          actualResult: { action: 'skipped', reasoning: 'test' },
          promptUsed: 'test',
          promptVersion: 'v1',
          isRatchetCase: false,
          wasRegression: false,
        });
      }

      await storage.pruneEvolverTestCases(5);
      const remaining = await storage.listEvolverTestCases();

      // 3 ratchet + 5 recent non-ratchet = 8
      expect(remaining).toHaveLength(8);
      expect(remaining.filter(c => c.isRatchetCase)).toHaveLength(3);
      expect(remaining.filter(c => !c.isRatchetCase)).toHaveLength(5);
    });
  });
});
