// src/integrations/registry.ts
import type { Integration } from '../types.js';
import type { StorageInterface } from '../storage/interface.js';

export type { Integration };

export type AuthStatus = 'connected' | 'expired' | 'never' | 'unavailable';

export interface IntegrationWithStatus extends Integration {
  status: AuthStatus;
}

/**
 * Registry of all available integrations.
 * This gives the Mastermind context about what integrations exist
 * and what they can be used for.
 */
export const INTEGRATIONS: Integration[] = [
  {
    id: 'intend',
    name: 'intend.do',
    purpose: 'Track daily intentions, todos, and goals',
    authType: 'oauth',
  },
  {
    id: 'fs',
    name: 'Local Files',
    purpose: 'Append data to local CSV, JSON, or text files',
    authType: 'none',
  },
  {
    id: 'notes',
    name: 'Notes',
    purpose: 'Save notes about integrations and destinations',
    authType: 'none',
  },
  {
    id: 'sheets',
    name: 'Google Sheets',
    purpose: 'Capture data to Google Sheets - supports cell updates, row appends, and 2D lookups with fuzzy matching',
    authType: 'oauth',
  },
];

/**
 * Get an integration by its ID.
 */
export function getIntegration(id: string): Integration | undefined {
  return INTEGRATIONS.find(i => i.id === id);
}

/**
 * Get all integrations enriched with their current auth status for a user.
 *
 * Status meanings:
 * - 'connected': Auth is valid (tokens exist and not expired, or authType is 'none')
 * - 'expired': Tokens exist but have expired
 * - 'never': No tokens exist
 */
export async function getIntegrationsWithStatus(
  storage: StorageInterface,
  username: string
): Promise<IntegrationWithStatus[]> {
  const result: IntegrationWithStatus[] = [];

  for (const integration of INTEGRATIONS) {
    let status: AuthStatus;

    if (integration.id === 'fs' && process.env.K_SERVICE) {
      // Local filesystem not available on Cloud Run
      status = 'unavailable';
    } else if (integration.authType === 'none') {
      // Integrations that don't require auth are always connected
      status = 'connected';
    } else if (integration.id === 'intend') {
      // Check intend.do OAuth tokens
      const tokens = await storage.getIntendTokens(username);
      if (!tokens) {
        status = 'never';
      } else {
        const expiresAt = new Date(tokens.expiresAt);
        if (expiresAt.getTime() < Date.now()) {
          status = 'expired';
        } else {
          status = 'connected';
        }
      }
    } else if (integration.id === 'sheets') {
      const tokens = await storage.getSheetsTokens(username);
      status = tokens ? 'connected' : 'never';
    } else {
      // Default for unknown oauth/api-key integrations
      status = 'never';
    }

    result.push({
      ...integration,
      status,
    });
  }

  return result;
}
