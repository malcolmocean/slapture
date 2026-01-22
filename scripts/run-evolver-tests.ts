#!/usr/bin/env tsx
// scripts/run-evolver-tests.ts
//
// Run evolver test cases against the current prompt.
// Use this when modifying the evolver prompt to check for regressions.
//
// Usage: pnpm test:evolver

import 'dotenv/config';
import { Storage } from '../src/storage/index.js';
import { EvolverTestRunner } from '../src/mastermind/evolver-test-runner.js';

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable not set');
    process.exit(1);
  }

  const storage = new Storage('./data');
  const runner = new EvolverTestRunner(apiKey, storage);

  console.log('Loading evolver test cases...');
  const testCases = await storage.listEvolverTestCases();

  if (testCases.length === 0) {
    console.log('No test cases found in data/evolver-tests/');
    console.log('Test cases are auto-saved when the evolver runs in production.');
    process.exit(0);
  }

  const ratchetCount = testCases.filter(tc => tc.isRatchetCase).length;
  const nonRatchetCount = testCases.length - ratchetCount;

  console.log(`Found ${testCases.length} test cases:`);
  console.log(`  - ${ratchetCount} ratchet cases (evolved, never auto-deleted)`);
  console.log(`  - ${nonRatchetCount} non-ratchet cases (skipped, rolling window)`);
  console.log('');
  console.log('Running tests against current evolver prompt...');
  console.log('');

  const results = await runner.runAllTests();
  const report = runner.generateReport(results);

  console.log(report);

  if (results.failed > 0) {
    console.log('');
    console.log('Fix the evolver prompt to resolve regressions before committing.');
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Error running evolver tests:', err);
  process.exit(1);
});
