// tests/unit/pipeline-evolver-integration.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CapturePipeline } from '../../src/pipeline/index.js';
import { Storage } from '../../src/storage/index.js';
import { Route } from '../../src/types.js';
import fs from 'fs';

const TEST_DATA_DIR = './test-evolver-integration-data';
const TEST_FILESTORE = './test-evolver-integration-filestore';

// Mock Mastermind to route to existing
vi.mock('../../src/mastermind/index.js', () => ({
  Mastermind: class MockMastermind {
    async consult() {
      return {
        action: {
          action: 'route',
          routeId: 'route-gwen',
          reason: 'User said gwen memories (plural), likely meant gwen_memories',
        },
        promptUsed: 'You are the Slapture Mastermind...',
      };
    }
  },
}));

// Mock Evolver to return skip
vi.mock('../../src/mastermind/evolver.js', () => ({
  Evolver: class MockEvolver {
    buildPrompt() {
      return 'You are the Slapture Evolver...';
    }
    async evolve() {
      return {
        result: {
          action: 'skipped',
          reasoning: 'No obvious pattern - situational input',
        },
        promptUsed: 'You are the Slapture Evolver...',
      };
    }
    validateChanges() {
      return { passed: true, errors: [] };
    }
  },
}));

describe('Pipeline Evolver Integration', () => {
  let pipeline: CapturePipeline;
  let storage: Storage;

  beforeEach(async () => {
    storage = new Storage(TEST_DATA_DIR);

    // Create test route
    const gwenRoute: Route = {
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
      transformScript: "fs.appendFileSync(filePath, payload + '\\n')",
      createdAt: '2026-01-22T05:00:00Z',
      createdBy: 'mastermind',
      lastUsed: '2026-01-22T10:00:00Z',
    };
    await storage.saveRoute(gwenRoute);

    pipeline = new CapturePipeline(storage, TEST_FILESTORE, 'test-api-key');
  });

  afterEach(() => {
    vi.clearAllMocks();
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    fs.rmSync(TEST_FILESTORE, { recursive: true, force: true });
  });

  it('should save evolver test case when evolver runs', async () => {
    // Process something that will trigger mastermind -> evolver
    await pipeline.process('gwen memories: test input', 'testuser');

    // Check that a test case was saved
    const testCases = await storage.listEvolverTestCases();
    expect(testCases.length).toBeGreaterThan(0);

    const testCase = testCases[0];
    expect(testCase.input.newInput).toBe('gwen memories: test input');
    expect(testCase.input.routeName).toBe('gwen_memories');
    expect(testCase.actualResult.action).toBe('skipped');
    expect(testCase.isRatchetCase).toBe(false); // Skipped = not ratchet
  });

  it('should prune old test cases after saving', async () => {
    // Pre-populate with 6 non-ratchet test cases
    for (let i = 0; i < 6; i++) {
      await storage.saveEvolverTestCase({
        id: `old-tc-${i}`,
        timestamp: new Date(Date.now() - 100000 + i * 1000).toISOString(),
        input: {
          newInput: `old input ${i}`,
          routeId: 'route-gwen',
          routeName: 'gwen_memories',
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

    // Process to trigger evolver which should save + prune
    await pipeline.process('gwen memories: new input', 'testuser');

    const testCases = await storage.listEvolverTestCases();
    const nonRatchet = testCases.filter(tc => !tc.isRatchetCase);

    // Should have at most 5 non-ratchet (the new one + 4 old ones)
    expect(nonRatchet.length).toBeLessThanOrEqual(5);
  });
});
