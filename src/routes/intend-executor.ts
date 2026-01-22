import type { Route, Capture } from '../types';
import type { Storage } from '../storage';
import { IntendClient } from '../integrations/intend';

export interface IntendExecutionResult {
  status: 'success' | 'failed' | 'blocked_needs_auth' | 'blocked_auth_expired';
  error?: string;
  data?: unknown;
}

export class IntendExecutor {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  async execute(route: Route, capture: Capture): Promise<IntendExecutionResult> {
    // Get tokens
    const tokens = await this.storage.getIntendTokens();

    if (!tokens) {
      return {
        status: 'blocked_needs_auth',
        error: 'intend.do OAuth not configured. Please connect your account.'
      };
    }

    const client = new IntendClient(tokens);

    // Check token expiry
    if (client.isTokenExpired()) {
      return {
        status: 'blocked_auth_expired',
        error: 'intend.do access token has expired. Please re-authenticate.'
      };
    }

    // Extract payload
    const payload = capture.parsed?.payload || capture.raw;

    // Call API
    const result = await client.addIntention(payload);

    if (result.authExpired) {
      return {
        status: 'blocked_auth_expired',
        error: result.error
      };
    }

    if (!result.success) {
      return {
        status: 'failed',
        error: result.error
      };
    }

    return {
      status: 'success',
      data: result.data
    };
  }
}
