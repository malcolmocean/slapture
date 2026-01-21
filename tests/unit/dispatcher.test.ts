// tests/unit/dispatcher.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Dispatcher } from '../../src/dispatcher/index.js';
import { Route, ParseResult } from '../../src/types.js';

describe('Dispatcher', () => {
  let dispatcher: Dispatcher;
  const routes: Route[] = [
    {
      id: 'route-dump',
      name: 'dump',
      description: 'Dump to file',
      triggers: [{ type: 'prefix', pattern: 'dump', priority: 10 }],
      schema: null,
      recentItems: [],
      destinationType: 'fs',
      destinationConfig: { filePath: 'dump.txt' },
      transformScript: "fs.appendFileSync(filePath, payload + '\\n')",
      createdAt: '2026-01-21T12:00:00Z',
      createdBy: 'user',
      lastUsed: null,
    },
    {
      id: 'route-weight',
      name: 'weightlog',
      description: 'Log weight measurements',
      triggers: [
        { type: 'regex', pattern: '^weight\\s+[\\d.]+\\s*(kg|lbs?)?$', priority: 5 },
      ],
      schema: null,
      recentItems: [],
      destinationType: 'fs',
      destinationConfig: { filePath: 'weight.csv' },
      transformScript: null,
      createdAt: '2026-01-21T12:00:00Z',
      createdBy: 'mastermind',
      lastUsed: null,
    },
  ];

  beforeEach(() => {
    dispatcher = new Dispatcher(routes);
  });

  describe('explicit route matching', () => {
    it('should match explicit route with high confidence', () => {
      const parsed: ParseResult = {
        explicitRoute: 'dump',
        payload: 'test content',
        metadata: {},
      };

      const result = dispatcher.dispatch(parsed);

      expect(result.routeId).toBe('route-dump');
      expect(result.confidence).toBe('high');
    });

    it('should return null for unknown explicit route', () => {
      const parsed: ParseResult = {
        explicitRoute: 'unknown',
        payload: 'test',
        metadata: {},
      };

      const result = dispatcher.dispatch(parsed);

      expect(result.routeId).toBeNull();
      expect(result.reason).toContain('No route named');
    });
  });

  describe('trigger matching', () => {
    it('should match regex trigger with medium confidence', () => {
      const parsed: ParseResult = {
        explicitRoute: null,
        payload: 'weight 88.2kg',
        metadata: {},
      };

      const result = dispatcher.dispatch(parsed);

      expect(result.routeId).toBe('route-weight');
      expect(result.confidence).toBe('medium');
    });

    it('should return null when no triggers match', () => {
      const parsed: ParseResult = {
        explicitRoute: null,
        payload: 'random unmatched text',
        metadata: {},
      };

      const result = dispatcher.dispatch(parsed);

      expect(result.routeId).toBeNull();
      expect(result.reason).toContain('No matching triggers');
    });
  });

  describe('priority ordering', () => {
    it('should prefer higher priority triggers', () => {
      const routesWithConflict: Route[] = [
        ...routes,
        {
          id: 'route-low',
          name: 'low-priority',
          description: 'Low priority catch-all',
          triggers: [{ type: 'regex', pattern: '.*weight.*', priority: 1 }],
          schema: null,
          recentItems: [],
          destinationType: 'fs',
          destinationConfig: { filePath: 'low.txt' },
          transformScript: null,
          createdAt: '2026-01-21T12:00:00Z',
          createdBy: 'user',
          lastUsed: null,
        },
      ];
      const dispatcherWithConflict = new Dispatcher(routesWithConflict);

      const parsed: ParseResult = {
        explicitRoute: null,
        payload: 'weight 88.2kg',
        metadata: {},
      };

      const result = dispatcherWithConflict.dispatch(parsed);

      expect(result.routeId).toBe('route-weight'); // Higher priority
    });
  });
});
