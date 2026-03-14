import type { Route, Capture } from '../types.js';
import type { StorageInterface } from '../storage/interface.js';
import { IntendClient } from '../integrations/intend.js';

export interface IntendExecutionResult {
  status: 'success' | 'failed' | 'blocked_needs_auth' | 'blocked_auth_expired';
  error?: string;
  data?: unknown;
}

export class IntendExecutor {
  private storage: StorageInterface;

  constructor(storage: StorageInterface) {
    this.storage = storage;
  }

  async execute(route: Route, capture: Capture): Promise<IntendExecutionResult> {
    // Get tokens for the capture's user
    const tokens = await this.storage.getIntendTokens(capture.username);

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

    // The payload must already be in intend format (e.g. "1) do laundry", "&) task")
    const raw = capture.parsed?.payload || capture.raw;

    const result = await client.postIntention(raw);

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
