import type { IntendTokens } from '../types.js';

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
      const response = await fetch(`${this.tokens.baseUrl}/api/v0/u/me/intentions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.tokens.accessToken}`,
          'Content-Type': 'application/json'
        },
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
}
