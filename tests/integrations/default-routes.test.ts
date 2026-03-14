// tests/integrations/default-routes.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeTemplateHash,
  computeRouteHash,
  installDefaultRoutes,
  getDefaultRouteStatuses,
  restoreDefaultRoute,
} from '../../src/integrations/default-routes';
import type { Route } from '../../src/types';

const INTEND_TEMPLATE = {
  key: 'intend-format',
  name: 'intend',
  description: 'Intentions in intend.do format (e.g. "1) do laundry", "&) random task")',
  triggers: [{
    pattern: '^[^\\d\\sA-Za-z)]{0,3}(?:(?:\\d|[A-Z]{2})(?:,(?:\\d|[A-Z]{2}))*)?[^\\d\\sA-Z)]{0,3}(?:\\)+|//)\\s+.+',
    priority: 10,
  }],
  destinationType: 'intend' as const,
  destinationConfig: { baseUrl: '' },
  transformScript: null,
};

function makeStorage(routes: Route[] = []) {
  return {
    listRoutes: vi.fn().mockResolvedValue(routes),
    saveRoute: vi.fn().mockResolvedValue(undefined),
  };
}

describe('computeTemplateHash', () => {
  it('should return consistent hash for same template', () => {
    const h1 = computeTemplateHash(INTEND_TEMPLATE);
    const h2 = computeTemplateHash(INTEND_TEMPLATE);
    expect(h1).toBe(h2);
  });

  it('should return different hash when trigger pattern changes', () => {
    const modified = {
      ...INTEND_TEMPLATE,
      triggers: [{ pattern: 'different', priority: 10 }],
    };
    expect(computeTemplateHash(INTEND_TEMPLATE)).not.toBe(computeTemplateHash(modified));
  });

  it('should return different hash when destinationConfig changes', () => {
    const modified = {
      ...INTEND_TEMPLATE,
      destinationConfig: { filePath: 'foo.csv' },
    };
    expect(computeTemplateHash(INTEND_TEMPLATE)).not.toBe(computeTemplateHash(modified));
  });

  it('should ignore name and description changes', () => {
    const modified = {
      ...INTEND_TEMPLATE,
      name: 'different-name',
      description: 'different description',
    };
    expect(computeTemplateHash(INTEND_TEMPLATE)).toBe(computeTemplateHash(modified));
  });
});

describe('computeRouteHash', () => {
  it('should match computeTemplateHash for equivalent route', () => {
    const route = {
      triggers: [{ type: 'regex' as const, pattern: INTEND_TEMPLATE.triggers[0].pattern, priority: 10 }],
      destinationConfig: { baseUrl: '' },
    } as Route;
    expect(computeRouteHash(route)).toBe(computeTemplateHash(INTEND_TEMPLATE));
  });

  it('should differ when triggers change', () => {
    const route = {
      triggers: [{ type: 'regex' as const, pattern: 'different', priority: 10 }],
      destinationConfig: { baseUrl: '' },
    } as Route;
    expect(computeRouteHash(route)).not.toBe(computeTemplateHash(INTEND_TEMPLATE));
  });

  it('should ignore trigger stats and fireCount', () => {
    const route = {
      triggers: [{
        type: 'regex' as const,
        pattern: INTEND_TEMPLATE.triggers[0].pattern,
        priority: 10,
        fireCount: 42,
        stats: { totalFires: 42, lastFired: '2026-01-01', validationResults: {} },
      }],
      destinationConfig: { baseUrl: '' },
    } as Route;
    expect(computeRouteHash(route)).toBe(computeTemplateHash(INTEND_TEMPLATE));
  });
});

describe('installDefaultRoutes', () => {
  it('should create route when none exists', async () => {
    const storage = makeStorage([]);
    const count = await installDefaultRoutes('intend', storage as any);

    expect(count).toBe(1);
    expect(storage.saveRoute).toHaveBeenCalledTimes(1);

    const saved = storage.saveRoute.mock.calls[0][0] as Route;
    expect(saved.name).toBe('intend');
    expect(saved.destinationType).toBe('intend');
    expect(saved.createdBy).toBe('integration');
    expect(saved.defaultSource).toEqual({
      integrationId: 'intend',
      defaultKey: 'intend-format',
      templateHash: computeTemplateHash(INTEND_TEMPLATE),
    });
    expect(saved.triggers).toHaveLength(1);
    expect(saved.triggers[0].type).toBe('regex');
    expect(saved.triggers[0].status).toBe('live');
  });

  it('should skip when default route already exists', async () => {
    const existing: Partial<Route> = {
      id: 'existing-id',
      name: 'intend',
      defaultSource: {
        integrationId: 'intend',
        defaultKey: 'intend-format',
        templateHash: computeTemplateHash(INTEND_TEMPLATE),
      },
    };
    const storage = makeStorage([existing as Route]);
    const count = await installDefaultRoutes('intend', storage as any);

    expect(count).toBe(0);
    expect(storage.saveRoute).not.toHaveBeenCalled();
  });

  it('should return 0 for integration with no default routes', async () => {
    const storage = makeStorage([]);
    const count = await installDefaultRoutes('sheets', storage as any);
    expect(count).toBe(0);
  });
});

describe('getDefaultRouteStatuses', () => {
  it('should return "deleted" when no matching route exists', async () => {
    const storage = makeStorage([]);
    const statuses = await getDefaultRouteStatuses('intend', storage as any);

    expect(statuses).toHaveLength(1);
    expect(statuses[0].state).toBe('deleted');
    expect(statuses[0].template.key).toBe('intend-format');
    expect(statuses[0].existingRouteId).toBeUndefined();
  });

  it('should return "active" when route hash matches stored templateHash', async () => {
    const existing: Partial<Route> = {
      id: 'route-123',
      name: 'intend',
      triggers: [{ type: 'regex', pattern: INTEND_TEMPLATE.triggers[0].pattern, priority: 10 }],
      destinationConfig: { baseUrl: '' },
      defaultSource: {
        integrationId: 'intend',
        defaultKey: 'intend-format',
        templateHash: computeTemplateHash(INTEND_TEMPLATE),
      },
    };
    const storage = makeStorage([existing as Route]);
    const statuses = await getDefaultRouteStatuses('intend', storage as any);

    expect(statuses).toHaveLength(1);
    expect(statuses[0].state).toBe('active');
    expect(statuses[0].existingRouteId).toBe('route-123');
  });

  it('should return "modified" when route has different hash', async () => {
    const existing: Partial<Route> = {
      id: 'route-123',
      name: 'intend',
      triggers: [{ type: 'regex', pattern: 'custom-pattern', priority: 10 }],
      destinationConfig: { baseUrl: '' },
      defaultSource: {
        integrationId: 'intend',
        defaultKey: 'intend-format',
        templateHash: computeTemplateHash(INTEND_TEMPLATE),
      },
    };
    const storage = makeStorage([existing as Route]);
    const statuses = await getDefaultRouteStatuses('intend', storage as any);

    expect(statuses).toHaveLength(1);
    expect(statuses[0].state).toBe('modified');
  });

  it('should return empty array for integration with no defaults', async () => {
    const storage = makeStorage([]);
    const statuses = await getDefaultRouteStatuses('sheets', storage as any);
    expect(statuses).toEqual([]);
  });
});

describe('restoreDefaultRoute', () => {
  it('should create new route when state is deleted', async () => {
    const storage = makeStorage([]);
    await restoreDefaultRoute('intend', 'intend-format', storage as any);

    expect(storage.saveRoute).toHaveBeenCalledTimes(1);
    const saved = storage.saveRoute.mock.calls[0][0] as Route;
    expect(saved.name).toBe('intend');
    expect(saved.createdBy).toBe('integration');
  });

  it('should overwrite existing route when state is modified', async () => {
    const existing: Partial<Route> = {
      id: 'route-123',
      name: 'intend-custom',
      triggers: [{ type: 'regex', pattern: 'custom', priority: 5 }],
      destinationConfig: { baseUrl: '' },
      defaultSource: {
        integrationId: 'intend',
        defaultKey: 'intend-format',
        templateHash: 'old-hash',
      },
    };
    const storage = makeStorage([existing as Route]);
    await restoreDefaultRoute('intend', 'intend-format', storage as any);

    expect(storage.saveRoute).toHaveBeenCalledTimes(1);
    const saved = storage.saveRoute.mock.calls[0][0] as Route;
    expect(saved.id).toBe('route-123');
    expect(saved.triggers[0].pattern).toBe(INTEND_TEMPLATE.triggers[0].pattern);
    expect(saved.defaultSource?.templateHash).toBe(computeTemplateHash(INTEND_TEMPLATE));
  });

  it('should throw for unknown integration', async () => {
    const storage = makeStorage([]);
    await expect(restoreDefaultRoute('nope', 'key', storage as any)).rejects.toThrow();
  });

  it('should throw for unknown default key', async () => {
    const storage = makeStorage([]);
    await expect(restoreDefaultRoute('intend', 'nope', storage as any)).rejects.toThrow();
  });
});
