// src/integrations/sheets/firestore-auth.ts
import { Firestore } from '@google-cloud/firestore';
import type { SheetsAuthProvider, SheetsCredentials } from './types.js';

/**
 * Reads Google Sheets OAuth credentials from Firestore.
 * Stores per-user tokens at users/{userId}/integrations/sheets.
 * Client credentials (client_id, client_secret) come from env vars
 * or Secret Manager (they're app-level, not per-user).
 */
export class FirestoreSheetsAuthProvider implements SheetsAuthProvider {
  private db: Firestore;
  private clientId: string;
  private clientSecret: string;

  constructor(db: Firestore, clientId: string, clientSecret: string) {
    this.db = db;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  async getCredentials(userId: string): Promise<SheetsCredentials | null> {
    const doc = await this.db.collection('users').doc(userId).get();
    if (!doc.exists) return null;

    const data = doc.data();
    const sheetsTokens = data?.integrations?.sheets;
    if (!sheetsTokens?.accessToken || !sheetsTokens?.refreshToken) return null;

    return {
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      accessToken: sheetsTokens.accessToken,
      refreshToken: sheetsTokens.refreshToken,
    };
  }
}
