import { describe, it, expect } from 'vitest';
import { renderLlmInteractions, escapeHtml } from '../../src/dashboard/templates.js';
import type { ExecutionStep } from '../../src/types.js';

function makeStep(overrides: Partial<ExecutionStep> & Pick<ExecutionStep, 'step' | 'input' | 'output'>): ExecutionStep {
  return {
    timestamp: '2026-03-05T12:00:00Z',
    codeVersion: '1.0.0',
    durationMs: 150,
    ...overrides,
  };
}

describe('renderLlmInteractions', () => {
  it('returns empty string when no LLM steps exist', () => {
    const steps: ExecutionStep[] = [
      makeStep({ step: 'parse', input: {}, output: {} }),
      makeStep({ step: 'dispatch', input: {}, output: {} }),
      makeStep({ step: 'execute', input: {}, output: {} }),
    ];
    expect(renderLlmInteractions(steps, 'tok123')).toBe('');
  });

  it('renders a mastermind step with structured sections', () => {
    const steps: ExecutionStep[] = [
      makeStep({
        step: 'mastermind',
        durationMs: 2500,
        input: {
          dynamicInput: {
            raw: 'buy milk',
            parsed: { payload: 'buy milk' },
            dispatcherReason: 'no trigger matched',
            routesSnapshot: [
              { id: 'r1', name: 'Groceries', description: 'Grocery list', triggers: [{ pattern: 'food' }], recentItems: [{ raw: 'eggs' }] },
              { id: 'r2', name: 'Tasks', description: 'Todo items', triggers: [], recentItems: [] },
            ],
          },
          staticPrompt: 'You are the mastermind...',
        },
        output: {
          action: 'route',
          routeId: 'r1',
          reason: 'This is a grocery item',
        },
      }),
    ];
    const html = renderLlmInteractions(steps, 'tok123');

    // Section header
    expect(html).toContain('LLM Inspection');

    // Badge
    expect(html).toContain('Mastermind');
    expect(html).toContain('badge-mastermind');

    // Duration
    expect(html).toContain('2500ms');

    // "What it saw" content
    expect(html).toContain('buy milk');
    expect(html).toContain('no trigger matched');
    expect(html).toContain('Groceries');
    expect(html).toContain('Grocery list');

    // "What it decided" content
    expect(html).toContain('route');
    expect(html).toContain('r1');
    expect(html).toContain('This is a grocery item');

    // Raw prompt collapsible
    expect(html).toContain('Raw Prompt');
    expect(html).toContain('You are the mastermind...');

    // Raw response collapsible
    expect(html).toContain('Raw Response');
  });

  it('renders a route_validate step', () => {
    const steps: ExecutionStep[] = [
      makeStep({
        step: 'route_validate',
        durationMs: 800,
        input: {
          routeId: 'r1',
          trigger: '^grocery',
          input: 'grocery: apples',
        },
        output: {
          confidence: 'certain',
          reasoning: 'Clearly a grocery item',
          promptUsed: 'Validate this input...',
        },
      }),
    ];
    const html = renderLlmInteractions(steps, 'tok123');

    // Badge
    expect(html).toContain('Validator');
    expect(html).toContain('badge-validator');

    // Confidence with color
    expect(html).toContain('certain');
    expect(html).toContain('badge-success');

    // Reasoning
    expect(html).toContain('Clearly a grocery item');

    // Raw prompt from output.promptUsed
    expect(html).toContain('Validate this input...');
  });

  it('renders an evolve step', () => {
    const steps: ExecutionStep[] = [
      makeStep({
        step: 'evolve',
        durationMs: 3000,
        input: {
          dynamicInput: {
            newInput: 'get bread',
            mastermindReason: 'Looks like groceries',
            attempt: 1,
            routeSnapshot: {
              name: 'Groceries',
              description: 'Grocery list items',
              triggers: [{ type: 'regex', pattern: '^grocery', priority: 10 }],
              transformScript: null,
              recentItems: [{ raw: 'eggs' }, { raw: 'milk' }],
            },
          },
          staticPrompt: 'You are the evolver...',
        },
        output: {
          action: 'evolved',
          triggers: [
            { type: 'regex', pattern: '^grocery', priority: 10 },
            { type: 'regex', pattern: '^(get|buy)\\s', priority: 10 },
          ],
          reasoning: 'Added pattern for buy/get verbs',
          validationPassed: true,
          retriesUsed: 0,
        },
      }),
    ];
    const html = renderLlmInteractions(steps, 'tok123');

    // Badge
    expect(html).toContain('Evolver');
    expect(html).toContain('badge-evolver');

    // Action
    expect(html).toContain('evolved');
    expect(html).toContain('badge-success');

    // Triggers
    expect(html).toContain('^grocery');
    expect(html).toContain('^(get|buy)\\s');

    // Reasoning
    expect(html).toContain('Added pattern for buy/get verbs');
  });

  it('renders multiple LLM steps in order (mastermind before evolver)', () => {
    const steps: ExecutionStep[] = [
      makeStep({ step: 'parse', input: {}, output: {} }),
      makeStep({
        step: 'mastermind',
        input: {
          dynamicInput: { raw: 'x', parsed: {}, dispatcherReason: 'none', routesSnapshot: [] },
          staticPrompt: 'prompt1',
        },
        output: { action: 'route', routeId: 'r1', reason: 'first' },
      }),
      makeStep({
        step: 'evolve',
        input: {
          dynamicInput: {
            newInput: 'x', mastermindReason: 'test', attempt: 1,
            routeSnapshot: { name: 'R', description: 'd', triggers: [], transformScript: null, recentItems: [] },
          },
          staticPrompt: 'prompt2',
        },
        output: { action: 'skipped', reasoning: 'not needed' },
      }),
    ];
    const html = renderLlmInteractions(steps, 'tok123');

    const mastermindIdx = html.indexOf('Mastermind');
    const evolverIdx = html.indexOf('Evolver');
    expect(mastermindIdx).toBeLessThan(evolverIdx);
    expect(mastermindIdx).toBeGreaterThan(-1);
    expect(evolverIdx).toBeGreaterThan(-1);
  });

  it('escapes HTML in user input and LLM output (XSS prevention)', () => {
    const xss = '<script>alert("xss")</script>';
    const steps: ExecutionStep[] = [
      makeStep({
        step: 'mastermind',
        input: {
          dynamicInput: {
            raw: xss,
            parsed: {},
            dispatcherReason: 'reason',
            routesSnapshot: [{ id: 'r1', name: xss, description: 'safe', triggers: [], recentItems: [] }],
          },
          staticPrompt: 'prompt',
        },
        output: { action: 'route', routeId: 'r1', reason: xss },
      }),
    ];
    const html = renderLlmInteractions(steps, 'tok123');

    // Must not contain raw script tags
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('</script>');

    // Must contain escaped versions
    expect(html).toContain(escapeHtml(xss));
  });
});
