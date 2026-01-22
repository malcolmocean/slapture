// tests/unit/evolver-test-runner.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Storage } from '../../src/storage/index.js';
import { EvolverTestRunner, TestRunResult } from '../../src/mastermind/evolver-test-runner.js';
import { EvolverTestCase, EvolverResult } from '../../src/types.js';
import fs from 'fs';

const TEST_DATA_DIR = './test-data-runner';

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn(),
    };
  },
}));

describe('Evolver Test Runner', () => {
  let storage: Storage;
  let runner: EvolverTestRunner;

  beforeEach(() => {
    storage = new Storage(TEST_DATA_DIR);
    runner = new EvolverTestRunner('test-api-key', storage);
  });

  afterEach(() => {
    vi.clearAllMocks();
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  describe('runAllTests', () => {
    it('should run all test cases and report results', async () => {
      // Create test cases
      const skipCase: EvolverTestCase = {
        id: 'tc-skip',
        timestamp: '2026-01-22T10:00:00Z',
        input: {
          newInput: 'situational input',
          routeId: 'route-test',
          routeName: 'test_route',
          routeTriggers: [{ type: 'keyword', pattern: 'test', priority: 10 }],
          routeDescription: 'Test route',
          routeRecentItems: [],
          mastermindReason: 'Mastermind routed here',
        },
        expectedAction: 'skip',
        actualResult: { action: 'skipped', reasoning: 'No pattern' },
        promptUsed: 'old prompt',
        promptVersion: 'old',
        isRatchetCase: false,
        wasRegression: false,
      };

      await storage.saveEvolverTestCase(skipCase);

      // Mock evolver to return 'skipped' (matching expected)
      vi.spyOn(runner, 'runSingleTest' as any).mockResolvedValue({
        testCase: skipCase,
        actualAction: 'skip',
        expectedAction: 'skip',
        passed: true,
        reasoning: 'No pattern found',
      });

      const results = await runner.runAllTests();

      expect(results.total).toBe(1);
      expect(results.passed).toBe(1);
      expect(results.failed).toBe(0);
      expect(results.results).toHaveLength(1);
      expect(results.results[0].passed).toBe(true);
    });

    it('should detect regression when skip case now evolves', async () => {
      const skipCase: EvolverTestCase = {
        id: 'tc-skip-regression',
        timestamp: '2026-01-22T10:00:00Z',
        input: {
          newInput: 'input that should skip',
          routeId: 'route-test',
          routeName: 'test_route',
          routeTriggers: [{ type: 'keyword', pattern: 'test', priority: 10 }],
          routeDescription: 'Test route',
          routeRecentItems: [],
          mastermindReason: 'test',
        },
        expectedAction: 'skip',
        actualResult: { action: 'skipped', reasoning: 'Should skip' },
        promptUsed: 'old prompt',
        promptVersion: 'old',
        isRatchetCase: false,
        wasRegression: false,
      };

      await storage.saveEvolverTestCase(skipCase);

      // Mock evolver to return 'evolved' (NOT matching expected 'skip')
      vi.spyOn(runner, 'runSingleTest' as any).mockResolvedValue({
        testCase: skipCase,
        actualAction: 'evolved',
        expectedAction: 'skip',
        passed: false,
        reasoning: 'Added pattern',
        regressionType: 'false_positive',
      });

      const results = await runner.runAllTests();

      expect(results.total).toBe(1);
      expect(results.passed).toBe(0);
      expect(results.failed).toBe(1);
      expect(results.results[0].passed).toBe(false);
      expect(results.results[0].regressionType).toBe('false_positive');
    });

    it('should detect regression when evolved case now skips', async () => {
      const evolvedCase: EvolverTestCase = {
        id: 'tc-evolved-regression',
        timestamp: '2026-01-22T10:00:00Z',
        input: {
          newInput: 'gwenmemory: test',
          routeId: 'route-gwen',
          routeName: 'gwen_memories',
          routeTriggers: [{ type: 'keyword', pattern: 'gwen memory', priority: 10 }],
          routeDescription: 'Gwen memories',
          routeRecentItems: [],
          mastermindReason: 'Typo variant',
        },
        expectedAction: 'evolved',
        expectedTriggers: [{ type: 'regex', pattern: 'gwen\\s*memory', priority: 10 }],
        actualResult: {
          action: 'evolved',
          triggers: [{ type: 'regex', pattern: 'gwen\\s*memory', priority: 10 }],
          reasoning: 'Added regex',
        },
        promptUsed: 'old prompt',
        promptVersion: 'old',
        isRatchetCase: true,
        wasRegression: false,
      };

      await storage.saveEvolverTestCase(evolvedCase);

      // Mock evolver to return 'skipped' (NOT matching expected 'evolved')
      vi.spyOn(runner, 'runSingleTest' as any).mockResolvedValue({
        testCase: evolvedCase,
        actualAction: 'skip',
        expectedAction: 'evolved',
        passed: false,
        reasoning: 'No pattern found',
        regressionType: 'false_negative',
      });

      const results = await runner.runAllTests();

      expect(results.total).toBe(1);
      expect(results.passed).toBe(0);
      expect(results.failed).toBe(1);
      expect(results.results[0].regressionType).toBe('false_negative');
    });
  });

  describe('generateReport', () => {
    it('should generate human-readable report', async () => {
      const results: TestRunResult = {
        total: 3,
        passed: 2,
        failed: 1,
        results: [
          {
            testCase: { id: 'tc-1' } as EvolverTestCase,
            actualAction: 'skip',
            expectedAction: 'skip',
            passed: true,
            reasoning: 'OK',
          },
          {
            testCase: { id: 'tc-2' } as EvolverTestCase,
            actualAction: 'skip',
            expectedAction: 'skip',
            passed: true,
            reasoning: 'OK',
          },
          {
            testCase: { id: 'tc-3', input: { newInput: 'bad input' } } as EvolverTestCase,
            actualAction: 'evolved',
            expectedAction: 'skip',
            passed: false,
            reasoning: 'Added pattern',
            regressionType: 'false_positive',
          },
        ],
      };

      const report = runner.generateReport(results);

      expect(report).toContain('2/3 passed');
      expect(report).toContain('1 failed');
      expect(report).toContain('tc-3');
      expect(report).toContain('false_positive');
      expect(report).toContain('bad input');
    });
  });
});
