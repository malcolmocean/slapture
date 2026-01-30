// src/integrations/sheets/auth.ts
import { google, sheets_v4 } from 'googleapis';

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
