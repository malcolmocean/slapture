// src/integrations/sheets/auth.ts
import { google, sheets_v4 } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import type { SheetsAuthProvider, SheetsCredentials } from './types.js';

export interface SheetsAuth {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
}

export function createSheetsClient(auth: SheetsAuth): sheets_v4.Sheets {
  const oauth2Client = new google.auth.OAuth2(
    auth.clientId,
    auth.clientSecret
  );

  oauth2Client.setCredentials({
    access_token: auth.accessToken,
    refresh_token: auth.refreshToken,
  });

  return google.sheets({ version: 'v4', auth: oauth2Client });
}

/**
 * Reads Google Sheets credentials from local files.
 * Checks ./secrets/ first (personal creds), then ./tests/fixtures/ (committable test creds).
 */
export class FileSheetsAuthProvider implements SheetsAuthProvider {
  private secretsPath: string;
  private tokensPaths: string[];

  constructor(secretsDir: string = './secrets') {
    this.secretsPath = `${secretsDir}/google-secrets.json`;
    this.tokensPaths = [
      `${secretsDir}/google-tokens.json`,
      './tests/fixtures/google-test-tokens.json',
    ];
  }

  async getCredentials(_userId: string): Promise<SheetsCredentials | null> {
    if (!existsSync(this.secretsPath)) {
      return null;
    }

    const tokensPath = this.tokensPaths.find(p => existsSync(p));
    if (!tokensPath) {
      return null;
    }

    const creds = JSON.parse(readFileSync(this.secretsPath, 'utf-8'));
    const tokens = JSON.parse(readFileSync(tokensPath, 'utf-8'));

    return {
      clientId: creds.installed.client_id,
      clientSecret: creds.installed.client_secret,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    };
  }
}
