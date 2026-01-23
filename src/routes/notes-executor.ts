// src/routes/notes-executor.ts
import type { Route, Capture, NotesDestinationConfig } from '../types.js';
import type { Storage } from '../storage/index.js';

export interface NotesExecutionResult {
  status: 'success' | 'failed' | 'blocked_needs_auth' | 'blocked_auth_expired';
  error?: string;
  data?: unknown;
}

const REPLACE_PREFIX = 'REPLACE:';

export class NotesExecutor {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  async execute(route: Route, capture: Capture): Promise<NotesExecutionResult> {
    // Type assertion needed since TypeScript doesn't narrow destinationConfig based on destinationType
    const config = route.destinationConfig as NotesDestinationConfig;
    const username = capture.username;

    // Extract payload from capture
    let payload = capture.parsed?.payload || capture.raw;

    // Check for REPLACE: prefix (case-sensitive)
    const isReplace = payload.startsWith(REPLACE_PREFIX);
    if (isReplace) {
      payload = payload.slice(REPLACE_PREFIX.length);
    }

    try {
      if (config.target === 'integration') {
        await this.saveToIntegration(username, config.id, payload, isReplace);
      } else if (config.target === 'destination') {
        await this.saveToDestination(username, config.id, payload, isReplace);
      } else {
        return {
          status: 'failed',
          error: `Unknown target type: ${(config as any).target}`
        };
      }

      return {
        status: 'success',
        data: { target: config.target, id: config.id, appended: !isReplace }
      };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async saveToIntegration(
    username: string,
    integrationId: string,
    content: string,
    overwrite: boolean
  ): Promise<void> {
    if (overwrite) {
      await this.storage.saveIntegrationNote(username, integrationId, content);
    } else {
      const existing = await this.storage.getIntegrationNote(username, integrationId);
      const newContent = existing ? `${existing}\n${content}` : content;
      await this.storage.saveIntegrationNote(username, integrationId, newContent);
    }
  }

  private async saveToDestination(
    username: string,
    destinationId: string,
    content: string,
    overwrite: boolean
  ): Promise<void> {
    if (overwrite) {
      await this.storage.saveDestinationNote(username, destinationId, content);
    } else {
      const existing = await this.storage.getDestinationNote(username, destinationId);
      const newContent = existing ? `${existing}\n${content}` : content;
      await this.storage.saveDestinationNote(username, destinationId, newContent);
    }
  }
}
