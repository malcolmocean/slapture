import { describe, it, expect } from 'vitest';
import type { Capture, Route, IntegrationConfig } from '../../src/types';

describe('OAuth Types', () => {
  it('should allow blocked_needs_auth execution result', () => {
    const capture: Partial<Capture> = {
      executionResult: 'blocked_needs_auth'
    };
    expect(capture.executionResult).toBe('blocked_needs_auth');
  });

  it('should allow blocked_auth_expired execution result', () => {
    const capture: Partial<Capture> = {
      executionResult: 'blocked_auth_expired'
    };
    expect(capture.executionResult).toBe('blocked_auth_expired');
  });

  it('should support intend destination type', () => {
    const route: Partial<Route> = {
      destinationType: 'intend',
      destinationConfig: {
        baseUrl: 'https://intend.do'
      }
    };
    expect(route.destinationType).toBe('intend');
  });

  it('should support integration config structure', () => {
    const config: IntegrationConfig = {
      intend: {
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        expiresAt: '2026-01-22T12:00:00Z',
        baseUrl: 'https://intend.do'
      }
    };
    expect(config.intend?.accessToken).toBe('test-token');
  });
});
