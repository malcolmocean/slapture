// src/mastermind/evolver-test-runner.ts
import type { StorageInterface } from '../storage/interface.js';
import { Evolver, EvolverContext } from './evolver.js';
import { EvolverTestCase, EvolverResult, Route, RouteTrigger } from '../types.js';

export interface SingleTestResult {
  testCase: EvolverTestCase;
  actualAction: 'skip' | 'evolved' | 'failed';
  expectedAction: 'skip' | 'evolved';
  passed: boolean;
  reasoning: string;
  regressionType?: 'false_positive' | 'false_negative';
}

export interface TestRunResult {
  total: number;
  passed: number;
  failed: number;
  results: SingleTestResult[];
}

/**
 * Test runner for evolver prompt iteration.
 *
 * When modifying the evolver prompt, use this to verify no regressions:
 * 1. Run all test cases (last 5 auto-saved + all ratchet cases)
 * 2. Compare actual action to expected action
 * 3. Report any regressions
 */
export class EvolverTestRunner {
  private evolver: Evolver;
  private storage: StorageInterface;

  constructor(apiKey: string, storage: StorageInterface) {
    this.evolver = new Evolver(apiKey);
    this.storage = storage;
  }

  /**
   * Run all stored test cases against the current evolver prompt.
   */
  async runAllTests(): Promise<TestRunResult> {
    const testCases = await this.storage.listEvolverTestCases();
    const results: SingleTestResult[] = [];

    for (const testCase of testCases) {
      const result = await this.runSingleTest(testCase);
      results.push(result);
    }

    return {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      results,
    };
  }

  /**
   * Run a single test case and compare to expected result.
   */
  async runSingleTest(testCase: EvolverTestCase): Promise<SingleTestResult> {
    // Reconstruct route from test case input
    const route: Route = {
      id: testCase.input.routeId,
      name: testCase.input.routeName,
      description: testCase.input.routeDescription,
      triggers: testCase.input.routeTriggers,
      schema: null,
      recentItems: testCase.input.routeRecentItems.map((raw, i) => ({
        captureId: `tc-recent-${i}`,
        raw,
        timestamp: new Date().toISOString(),
        wasCorrect: true,
      })),
      destinationType: 'fs',
      destinationConfig: { filePath: 'test.txt' },
      transformScript: null,
      createdAt: new Date().toISOString(),
      createdBy: 'user',
      lastUsed: null,
    };

    const context: EvolverContext = {
      newInput: testCase.input.newInput,
      route,
      mastermindReason: testCase.input.mastermindReason,
    };

    const { result } = await this.evolver.evolve(context);

    // Determine actual action
    let actualAction: 'skip' | 'evolved' | 'failed';
    if (result.action === 'skipped') {
      actualAction = 'skip';
    } else if (result.action === 'evolved') {
      actualAction = 'evolved';
    } else {
      actualAction = 'failed';
    }

    // Compare to expected
    const passed = actualAction === testCase.expectedAction ||
      (actualAction === 'failed' && testCase.expectedAction === 'skip'); // Failed = skip for comparison

    let regressionType: 'false_positive' | 'false_negative' | undefined;
    if (!passed) {
      if (testCase.expectedAction === 'skip' && actualAction === 'evolved') {
        // Should have skipped but evolved - false positive (overfitting)
        regressionType = 'false_positive';
      } else if (testCase.expectedAction === 'evolved' && actualAction !== 'evolved') {
        // Should have evolved but didn't - false negative (too conservative)
        regressionType = 'false_negative';
      }
    }

    return {
      testCase,
      actualAction,
      expectedAction: testCase.expectedAction,
      passed,
      reasoning: result.reasoning,
      regressionType,
    };
  }

  /**
   * Generate a human-readable report of test results.
   */
  generateReport(results: TestRunResult): string {
    const lines: string[] = [];

    lines.push(`Evolver Test Results: ${results.passed}/${results.total} passed`);
    lines.push('');

    if (results.failed > 0) {
      lines.push(`${results.failed} failed:`);
      lines.push('');

      for (const result of results.results.filter(r => !r.passed)) {
        lines.push(`  - ${result.testCase.id}`);
        lines.push(`    Input: "${result.testCase.input.newInput}"`);
        lines.push(`    Expected: ${result.expectedAction}, Got: ${result.actualAction}`);
        if (result.regressionType) {
          lines.push(`    Regression type: ${result.regressionType}`);
        }
        lines.push(`    Reasoning: ${result.reasoning}`);
        lines.push('');
      }
    } else {
      lines.push('All tests passed!');
    }

    return lines.join('\n');
  }
}
