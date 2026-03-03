// tests/integrations/registry.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Storage } from '../../src/storage/index.js';
import {
  INTEGRATIONS,
  getIntegration,
  getIntegrationsWithStatus,
  type Integration,
  type IntegrationWithStatus,
} from '../../src/integrations/registry.js';
import fs from 'fs';

const TEST_DATA_DIR = './test-data-registry';

describe('Integration Registry', () => {
  describe('INTEGRATIONS constant', () => {
    it('should have exactly 4 integrations', () => {
      expect(INTEGRATIONS).toHaveLength(4);
    });

    it('should have intend integration with correct properties', () => {
      const intend = INTEGRATIONS.find(i => i.id === 'intend');
      expect(intend).toBeDefined();
      expect(intend?.name).toBe('intend.do');
      expect(intend?.purpose).toBe('Track daily intentions, todos, and goals');
      expect(intend?.authType).toBe('oauth');
    });

    it('should have fs integration with correct properties', () => {
      const fs = INTEGRATIONS.find(i => i.id === 'fs');
      expect(fs).toBeDefined();
      expect(fs?.name).toBe('Local Files');
      expect(fs?.purpose).toBe('Append data to local CSV, JSON, or text files');
      expect(fs?.authType).toBe('none');
    });

    it('should have notes integration with correct properties', () => {
      const notes = INTEGRATIONS.find(i => i.id === 'notes');
      expect(notes).toBeDefined();
      expect(notes?.name).toBe('Notes');
      expect(notes?.purpose).toBe('Save notes about integrations and destinations');
      expect(notes?.authType).toBe('none');
    });

    it('should have sheets integration with correct properties', () => {
      const sheets = INTEGRATIONS.find(i => i.id === 'sheets');
      expect(sheets).toBeDefined();
      expect(sheets?.name).toBe('Google Sheets');
      expect(sheets?.purpose).toBe('Capture data to Google Sheets - supports cell updates, row appends, and 2D lookups with fuzzy matching');
      expect(sheets?.authType).toBe('oauth');
    });

    it('should have valid authType for all integrations', () => {
      const validAuthTypes = ['oauth', 'api-key', 'none'];
      for (const integration of INTEGRATIONS) {
        expect(validAuthTypes).toContain(integration.authType);
      }
    });
  });

  describe('getIntegration', () => {
    it('should return integration by id', () => {
      const intend = getIntegration('intend');
      expect(intend?.id).toBe('intend');
      expect(intend?.name).toBe('intend.do');
    });

    it('should return undefined for unknown id', () => {
      const unknown = getIntegration('unknown-integration');
      expect(unknown).toBeUndefined();
    });

    it('should return fs integration', () => {
      const fs = getIntegration('fs');
      expect(fs?.id).toBe('fs');
    });

    it('should return notes integration', () => {
      const notes = getIntegration('notes');
      expect(notes?.id).toBe('notes');
    });
  });

  describe('getIntegrationsWithStatus', () => {
    let storage: Storage;

    beforeEach(() => {
      storage = new Storage(TEST_DATA_DIR);
    });

    afterEach(() => {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    });

    it('should return all integrations with status', async () => {
      const integrations = await getIntegrationsWithStatus(storage, 'testuser');
      expect(integrations).toHaveLength(4);

      // Each should have status field
      for (const integration of integrations) {
        expect(['connected', 'expired', 'never']).toContain(integration.status);
      }
    });

    it('should return "connected" for fs integration (authType: none)', async () => {
      const integrations = await getIntegrationsWithStatus(storage, 'testuser');
      const fs = integrations.find(i => i.id === 'fs');
      expect(fs?.status).toBe('connected');
    });

    it('should return "connected" for notes integration (authType: none)', async () => {
      const integrations = await getIntegrationsWithStatus(storage, 'testuser');
      const notes = integrations.find(i => i.id === 'notes');
      expect(notes?.status).toBe('connected');
    });

    it('should return "never" for intend when no tokens exist', async () => {
      const integrations = await getIntegrationsWithStatus(storage, 'testuser');
      const intend = integrations.find(i => i.id === 'intend');
      expect(intend?.status).toBe('never');
    });

    it('should return "connected" for intend when valid tokens exist', async () => {
      // Save valid tokens (future expiry)
      await storage.saveIntendTokens('testuser', {
        accessToken: 'valid-token',
        refreshToken: 'refresh',
        expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour in future
        baseUrl: 'https://intend.do'
      });

      const integrations = await getIntegrationsWithStatus(storage, 'testuser');
      const intend = integrations.find(i => i.id === 'intend');
      expect(intend?.status).toBe('connected');
    });

    it('should return "expired" for intend when tokens are expired', async () => {
      // Save expired tokens
      await storage.saveIntendTokens('testuser', {
        accessToken: 'expired-token',
        refreshToken: 'refresh',
        expiresAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour in past
        baseUrl: 'https://intend.do'
      });

      const integrations = await getIntegrationsWithStatus(storage, 'testuser');
      const intend = integrations.find(i => i.id === 'intend');
      expect(intend?.status).toBe('expired');
    });

    it('should check status per-user', async () => {
      // User1 has valid tokens
      await storage.saveIntendTokens('user1', {
        accessToken: 'user1-token',
        refreshToken: 'refresh',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        baseUrl: 'https://intend.do'
      });

      // User2 has no tokens
      const user1Integrations = await getIntegrationsWithStatus(storage, 'user1');
      const user2Integrations = await getIntegrationsWithStatus(storage, 'user2');

      const user1Intend = user1Integrations.find(i => i.id === 'intend');
      const user2Intend = user2Integrations.find(i => i.id === 'intend');

      expect(user1Intend?.status).toBe('connected');
      expect(user2Intend?.status).toBe('never');
    });

    it('should preserve all original integration properties', async () => {
      const integrations = await getIntegrationsWithStatus(storage, 'testuser');
      const intend = integrations.find(i => i.id === 'intend');

      // All original properties should be present
      expect(intend?.id).toBe('intend');
      expect(intend?.name).toBe('intend.do');
      expect(intend?.purpose).toBe('Track daily intentions, todos, and goals');
      expect(intend?.authType).toBe('oauth');
      expect(intend?.status).toBeDefined();
    });
  });
});

describe('Integration type', () => {
  it('should have required properties', () => {
    const integration: Integration = {
      id: 'test',
      name: 'Test Integration',
      purpose: 'For testing',
      authType: 'none'
    };

    expect(integration.id).toBe('test');
    expect(integration.name).toBe('Test Integration');
    expect(integration.purpose).toBe('For testing');
    expect(integration.authType).toBe('none');
  });

  it('should allow oauth authType', () => {
    const integration: Integration = {
      id: 'oauth-test',
      name: 'OAuth Test',
      purpose: 'Test OAuth',
      authType: 'oauth'
    };
    expect(integration.authType).toBe('oauth');
  });

  it('should allow api-key authType', () => {
    const integration: Integration = {
      id: 'apikey-test',
      name: 'API Key Test',
      purpose: 'Test API Key',
      authType: 'api-key'
    };
    expect(integration.authType).toBe('api-key');
  });
});
