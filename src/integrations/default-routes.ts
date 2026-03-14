import { v4 as uuidv4 } from 'uuid';
import { createTrigger } from '../types.js';
import type { Route, DefaultRouteTemplate } from '../types.js';
import type { StorageInterface } from '../storage/interface.js';
import { getIntegration } from './registry.js';

export function computeTemplateHash(template: DefaultRouteTemplate): string {
  const hashInput = JSON.stringify({
    triggers: template.triggers,
    destinationConfig: template.destinationConfig,
  });
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    const char = hashInput.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

export function computeRouteHash(route: Route): string {
  const hashInput = JSON.stringify({
    triggers: route.triggers.map(t => ({ pattern: t.pattern, priority: t.priority })),
    destinationConfig: route.destinationConfig,
  });
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    const char = hashInput.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

function buildRouteFromTemplate(
  template: DefaultRouteTemplate,
  integrationId: string,
  existingId?: string,
): Route {
  return {
    id: existingId ?? `route-${uuidv4()}`,
    name: template.name,
    description: template.description,
    triggers: template.triggers.map(t => createTrigger(t.pattern, { priority: t.priority })),
    schema: null,
    recentItems: [],
    destinationType: template.destinationType,
    destinationConfig: template.destinationConfig,
    transformScript: template.transformScript,
    createdAt: new Date().toISOString(),
    createdBy: 'integration',
    lastUsed: null,
    defaultSource: {
      integrationId,
      defaultKey: template.key,
      templateHash: computeTemplateHash(template),
    },
  };
}

export async function installDefaultRoutes(
  integrationId: string,
  storage: StorageInterface,
): Promise<number> {
  const integration = getIntegration(integrationId);
  if (!integration?.defaultRoutes?.length) return 0;

  const existingRoutes = await storage.listRoutes();
  let created = 0;

  for (const template of integration.defaultRoutes) {
    const exists = existingRoutes.some(
      r => r.defaultSource?.integrationId === integrationId
        && r.defaultSource?.defaultKey === template.key
    );
    if (exists) continue;

    const route = buildRouteFromTemplate(template, integrationId);
    await storage.saveRoute(route);
    created++;
  }

  return created;
}

export type DefaultRouteState = 'active' | 'modified' | 'deleted';

export interface DefaultRouteStatus {
  template: DefaultRouteTemplate;
  state: DefaultRouteState;
  existingRouteId?: string;
}

export async function getDefaultRouteStatuses(
  integrationId: string,
  storage: StorageInterface,
): Promise<DefaultRouteStatus[]> {
  const integration = getIntegration(integrationId);
  if (!integration?.defaultRoutes?.length) return [];

  const existingRoutes = await storage.listRoutes();

  return integration.defaultRoutes.map(template => {
    const existing = existingRoutes.find(
      r => r.defaultSource?.integrationId === integrationId
        && r.defaultSource?.defaultKey === template.key
    );

    if (!existing) {
      return { template, state: 'deleted' as const };
    }

    const currentHash = computeRouteHash(existing);
    const installedHash = existing.defaultSource!.templateHash;

    if (currentHash === installedHash) {
      return { template, state: 'active' as const, existingRouteId: existing.id };
    }

    return { template, state: 'modified' as const, existingRouteId: existing.id };
  });
}

export async function restoreDefaultRoute(
  integrationId: string,
  defaultKey: string,
  storage: StorageInterface,
): Promise<void> {
  const integration = getIntegration(integrationId);
  if (!integration?.defaultRoutes?.length) {
    throw new Error(`Integration '${integrationId}' has no default routes`);
  }

  const template = integration.defaultRoutes.find(t => t.key === defaultKey);
  if (!template) {
    throw new Error(`Default route '${defaultKey}' not found on integration '${integrationId}'`);
  }

  const existingRoutes = await storage.listRoutes();
  const existing = existingRoutes.find(
    r => r.defaultSource?.integrationId === integrationId
      && r.defaultSource?.defaultKey === defaultKey
  );

  const route = buildRouteFromTemplate(template, integrationId, existing?.id);
  await storage.saveRoute(route);
}
