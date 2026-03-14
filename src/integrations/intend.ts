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
   * Post a raw intention string to intend.do.
   *
   * The string must match intend.do's intention format:
   *   /^([^\d\sA-Za-z)]{0,3})((?:\d|[A-Z]{2})?(?:,(?:\d|[A-Z]{2}))*)([^\d\sA-Z)]{0,3})(\)+|\/\/)\s+(.*)/u
   *
   * Broken down:
   *   _c        = extras before goal code (usually blank, '&' for misc)
   *   gids      = goal code(s): digit 0-9, two uppercase letters (e.g. FI),
   *               empty, or comma-separated (e.g. "1,FI,3")
   *   c_        = extras after goal code (usually blank, '*' → starred ★)
   *   delimiter = ')' (task) or '//' (comment)
   *   t         = the intention text
   *
   * Examples: "1) do laundry", "FI) run 5k", "&) random task", ") just a task"
   */
  async postIntention(raw: string): Promise<IntendResult> {
    try {
      const response = await fetch(`${this.tokens.baseUrl}/api/v0/u/me/intentions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.tokens.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ raw })
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
