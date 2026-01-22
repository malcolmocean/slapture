import type { IntendTokens } from '../types';

export interface IntendResult {
  success: boolean;
  data?: unknown;
  error?: string;
  authExpired?: boolean;
}

export class IntendClient {
  private tokens: IntendTokens;

  constructor(tokens: IntendTokens) {
    this.tokens = tokens;
  }

  isTokenExpired(): boolean {
    const expiresAt = new Date(this.tokens.expiresAt);
    // Add 5 minute buffer
    return expiresAt.getTime() - 5 * 60 * 1000 < Date.now();
  }

  async addIntention(text: string): Promise<IntendResult> {
    try {
      const response = await fetch(`${this.tokens.baseUrl}/api/intentions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.tokens.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text })
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
