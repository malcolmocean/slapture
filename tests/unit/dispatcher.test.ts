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
      triggers: [{ type: 'regex', pattern: '^dump\\b', priority: 10 }],
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

  describe('trigger matching', () => {
    it('should match regex trigger with medium confidence', () => {
      const parsed: ParseResult = {
        payload: 'weight 88.2kg',
        metadata: {},
      };

      const result = dispatcher.dispatch(parsed);

      expect(result.routeId).toBe('route-weight');
      expect(result.confidence).toBe('medium');
    });

    it('should return null when no triggers match', () => {
      const parsed: ParseResult = {
        payload: 'random unmatched text',
        metadata: {},
      };

      const result = dispatcher.dispatch(parsed);

      expect(result.routeId).toBeNull();
      expect(result.reason).toContain('No matching triggers');
    });

    it('should match dump route via regex trigger', () => {
      const parsed: ParseResult = {
        payload: 'dump: test content',
        metadata: {},
      };

      const result = dispatcher.dispatch(parsed);

      expect(result.routeId).toBe('route-dump');
      expect(result.confidence).toBe('medium');
    });
  });

  describe('trigger captures', () => {
    it('should extract named fields from capture groups', () => {
      const routesWithCaptures: Route[] = [
        {
          id: 'route-gwen',
          name: 'gwen_memories',
          description: 'Gwen memories',
          triggers: [{
            type: 'regex',
            pattern: '^gwen\\s+memor(?:y|ies?):\\s*(.+)',
            captures: { content: 1 },
            priority: 10,
          }],
          schema: null,
          recentItems: [],
          destinationType: 'sheets',
          destinationConfig: { spreadsheetId: 'abc', sheetName: 'Sheet1', operation: {} },
          transformScript: null,
          createdAt: '2026-01-01T00:00:00Z',
          createdBy: 'mastermind',
          lastUsed: null,
        },
      ];
      const d = new Dispatcher(routesWithCaptures);

      const result = d.dispatch({
        payload: 'gwen memory: she woke up early at 5am',
        metadata: {},
      });

      expect(result.routeId).toBe('route-gwen');
      expect(result.extractedFields).toEqual({ content: 'she woke up early at 5am' });
    });

    it('should return undefined extractedFields when trigger has no captures', () => {
      const result = dispatcher.dispatch({
        payload: 'weight 88.2kg',
        metadata: {},
      });

      expect(result.routeId).toBe('route-weight');
      expect(result.extractedFields).toBeUndefined();
    });

    it('should extract multiple fields from different capture groups', () => {
      const routesMulti: Route[] = [
        {
          id: 'route-multi',
          name: 'multi_field',
          description: 'Multiple field extraction',
          triggers: [{
            type: 'regex',
            pattern: '^(\\w+)\\s+(\\d+\\.?\\d*)\\s*(kg|lbs?)?$',
            captures: { metric: 1, value: 2, unit: 3 },
            priority: 10,
          }],
          schema: null,
          recentItems: [],
          destinationType: 'sheets',
          destinationConfig: { spreadsheetId: 'abc', sheetName: 'Sheet1', operation: {} },
          transformScript: null,
          createdAt: '2026-01-01T00:00:00Z',
          createdBy: 'mastermind',
          lastUsed: null,
        },
      ];
      const d = new Dispatcher(routesMulti);

      const result = d.dispatch({
        payload: 'weight 85.5 kg',
        metadata: {},
      });

      expect(result.extractedFields).toEqual({ metric: 'weight', value: '85.5', unit: 'kg' });
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
        payload: 'weight 88.2kg',
        metadata: {},
      };

      const result = dispatcherWithConflict.dispatch(parsed);

      expect(result.routeId).toBe('route-weight'); // Higher priority
    });
  });
});
