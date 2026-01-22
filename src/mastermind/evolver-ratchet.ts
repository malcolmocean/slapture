// src/mastermind/evolver-ratchet.ts
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { EvolverTestCase, EvolverResult, Route, RouteTrigger } from '../types.js';

export interface EvolverTestCaseInput {
  newInput: string;
  route: Route;
  mastermindReason: string;
  promptUsed: string;
}

/**
 * Create an EvolverTestCase from evolver input and result.
 *
 * Cases where evolution happened (action: 'evolved') are marked as ratchet cases.
 * Ratchet cases are never auto-deleted and serve as regression tests.
 */
export function createEvolverTestCase(
  input: EvolverTestCaseInput,
  result: EvolverResult
): EvolverTestCase {
  const isEvolved = result.action === 'evolved';

  // For expected action: evolved stays evolved, everything else (skipped, failed) becomes 'skip'
  const expectedAction = isEvolved ? 'evolved' : 'skip';

  return {
    id: `evtc-${uuidv4()}`,
    timestamp: new Date().toISOString(),
    input: {
      newInput: input.newInput,
      routeId: input.route.id,
      routeName: input.route.name,
      routeTriggers: input.route.triggers,
      routeDescription: input.route.description,
      routeRecentItems: input.route.recentItems.map(r => r.raw),
      mastermindReason: input.mastermindReason,
    },
    expectedAction,
    expectedTriggers: isEvolved ? result.triggers : undefined,
    actualResult: result,
    promptUsed: input.promptUsed,
    promptVersion: getPromptVersion(input.promptUsed),
    isRatchetCase: isEvolved, // Only evolved cases are ratchet
    wasRegression: false,
  };
}

/**
 * Get a short hash of the prompt for version tracking.
 * Used to detect when the prompt has changed.
 */
export function getPromptVersion(prompt: string): string {
  return crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 8);
}
