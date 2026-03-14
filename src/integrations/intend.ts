import type { IntendTokens } from '../types.js';

export interface IntendResult {
  success: boolean;
  data?: unknown;
  error?: string;
  authExpired?: boolean;
}

export type IntendAuthMode = 'bearer' | 'query_param';

export class IntendClient {
  private tokens: IntendTokens;
  private authMode: IntendAuthMode;

  constructor(tokens: IntendTokens, authMode: IntendAuthMode = 'bearer') {
    this.tokens = tokens;
    this.authMode = authMode;
  }

  isTokenExpired(): boolean {
    const expiresAt = new Date(this.tokens.expiresAt);
    // Add 5 minute buffer
    return expiresAt.getTime() - 5 * 60 * 1000 < Date.now();
  }

  private buildUrl(path: string): string {
    const url = `${this.tokens.baseUrl}${path}`;
    if (this.authMode === 'query_param') {
      return `${url}?auth_token=${this.tokens.accessToken}`;
    }
    return url;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authMode === 'bearer') {
      headers['Authorization'] = `Bearer ${this.tokens.accessToken}`;
    }
    return headers;
  }

  /**
   * Add an intention to intend.do
   * @param text - The intention text
   * @param goal - Goal number 1-9, or '&' for no specific goal (default: '&')
   *
   * Intention format: "X) text" where X is goal number (1-9) or & for ungrouped
   * Goals are user-defined (e.g., goal1=fitness, goal2=career)
   */
  async addIntention(text: string, goal: string = '&'): Promise<IntendResult> {
    // Format: "X) text" where X is 1-9 or &
    const formattedIntention = `${goal}) ${text}`;

    try {
      const response = await fetch(this.buildUrl('/api/v0/u/me/intentions'), {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ raw: formattedIntention })
      });

      if (response.status === 401) {
        return { success: false, authExpired: true, error: 'Token expired or invalid' };
      }

      if (!response.ok) {
        return { success: false, error: `API error: ${response.status} ${response.statusText}` };
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: `Network error: ${error}` };
    }
  }

  async getIntentions(): Promise<IntendResult> {
    try {
      const response = await fetch(this.buildUrl('/api/v0/u/me/today/core.json'), {
        headers: this.buildHeaders(),
      });

      if (response.status === 401) {
        return { success: false, authExpired: true, error: 'Token expired or invalid' };
      }

      if (!response.ok) {
        return { success: false, error: `API error: ${response.status} ${response.statusText}` };
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: `Network error: ${error}` };
    }
  }

  async getActiveGoals(): Promise<IntendResult> {
    try {
      const response = await fetch(this.buildUrl('/api/v0/u/me/goals/active.json'), {
        headers: this.buildHeaders(),
      });

      if (response.status === 401) {
        return { success: false, authExpired: true, error: 'Token expired or invalid' };
      }

      if (!response.ok) {
        return { success: false, error: `API error: ${response.status} ${response.statusText}` };
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: `Network error: ${error}` };
    }
  }

  async completeById(zid: string): Promise<IntendResult> {
    try {
      const response = await fetch(this.buildUrl(`/api/v0/u/me/completeById/${zid}`), {
        method: 'POST',
        headers: this.buildHeaders(),
      });

      if (response.status === 401) {
        return { success: false, authExpired: true, error: 'Token expired or invalid' };
      }

      if (!response.ok) {
        return { success: false, error: `API error: ${response.status} ${response.statusText}` };
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: `Network error: ${error}` };
    }
  }

  async getUserInfo(): Promise<IntendResult> {
    try {
      const response = await fetch(this.buildUrl('/api/v0/u/me/userinfo.json'), {
        headers: this.buildHeaders(),
      });

      if (response.status === 401) {
        return { success: false, authExpired: true, error: 'Token expired or invalid' };
      }

      if (!response.ok) {
        return { success: false, error: `API error: ${response.status} ${response.statusText}` };
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: `Network error: ${error}` };
    }
  }
}
