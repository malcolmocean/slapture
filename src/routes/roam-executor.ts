// src/routes/roam-executor.ts
import type { Route, Capture } from '../types.js';
import type { StorageInterface } from '../storage/interface.js';
import type { RoamDestinationConfig, DailyTaggedOperation, PageChildOperation } from '../integrations/roam/types.js';
import { RoamClient } from '../integrations/roam/client.js';

export interface RoamExecutionResult {
  status: 'success' | 'failed' | 'blocked_needs_auth' | 'blocked_auth_expired';
  error?: string;
  data?: unknown;
}

export class RoamExecutor {
  private storage: StorageInterface;

  constructor(storage: StorageInterface) {
    this.storage = storage;
  }

  async execute(route: Route, capture: Capture): Promise<RoamExecutionResult> {
    const config = route.destinationConfig as RoamDestinationConfig;
    const payload = capture.parsed?.payload || capture.raw;

    // Get Roam config for user
    const roamConfig = await this.storage.getRoamConfig(capture.username);
    if (!roamConfig) {
      return {
        status: 'blocked_needs_auth',
        error: 'Roam Research not configured. Please add your graph API token.',
      };
    }

    // Find matching graph
    const graphConfig = roamConfig.graphs.find((g) => g.graphName === config.graphName);
    if (!graphConfig) {
      return {
        status: 'blocked_needs_auth',
        error: `Roam graph "${config.graphName}" not found in your configuration.`,
      };
    }

    const client = new RoamClient(graphConfig.graphName, graphConfig.token);

    try {
      const operation = config.operation;
      switch (operation.type) {
        case 'daily_tagged':
          return await this.executeDailyTagged(client, operation, payload);
        case 'page_child':
          return await this.executePageChild(client, operation, payload);
        default:
          return {
            status: 'failed',
            error: `Unknown Roam operation type: ${(operation as any).type}`,
          };
      }
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeDailyTagged(
    client: RoamClient,
    operation: DailyTaggedOperation,
    payload: string,
  ): Promise<RoamExecutionResult> {
    const todayTitle = RoamClient.todayPageTitle();
    const todayUid = RoamClient.todayPageUid();

    // Normalize tag: prefix with # if not already # or [[
    const tagText = operation.tag.startsWith('#') || operation.tag.startsWith('[[')
      ? operation.tag
      : `#${operation.tag}`;

    // Check if tag block exists on today's page
    let tagBlock = await client.findBlockOnPage(todayTitle, tagText);

    if (!tagBlock) {
      // Create the tag block on today's page
      await client.createBlock(todayUid, tagText);

      // Retry finding the tag block (API consistency backoff)
      for (let i = 0; i < 3; i++) {
        tagBlock = await client.findBlockOnPage(todayTitle, tagText);
        if (tagBlock) break;
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }

      if (!tagBlock) {
        return {
          status: 'failed',
          error: `Failed to find tag block "${tagText}" after creating it`,
        };
      }
    }

    const tagUid = tagBlock[':block/uid'] as string;
    await client.createBlock(tagUid, payload);

    return {
      status: 'success',
      data: { tagUid, todayTitle, tagText },
    };
  }

  private async executePageChild(
    client: RoamClient,
    operation: PageChildOperation,
    payload: string,
  ): Promise<RoamExecutionResult> {
    let page = await client.getPageByTitle(operation.pageTitle);

    if (!page) {
      await client.createPage(operation.pageTitle);
      page = await client.getPageByTitle(operation.pageTitle);

      if (!page) {
        return {
          status: 'failed',
          error: `Failed to find page "${operation.pageTitle}" after creating it`,
        };
      }
    }

    const parentUid = operation.parentBlockUid ?? (page[':block/uid'] as string);
    await client.createBlock(parentUid, payload);

    return {
      status: 'success',
      data: { pageTitle: operation.pageTitle, parentUid },
    };
  }
}
