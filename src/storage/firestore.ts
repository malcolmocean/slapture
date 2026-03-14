// src/storage/firestore.ts
import { Firestore } from '@google-cloud/firestore';
import type { StorageInterface } from './interface.js';
import type { Capture, Route, Config, ExecutionStep, EvolverTestCase, IntendTokens, SheetsTokens, RoamConfig, TriggerChangeReview, UserProfile, ApiKey } from '../types.js';
import type { HygieneSignal } from '../hygiene/index.js';

export class FirestoreStorage implements StorageInterface {
  public db: Firestore;

  constructor(projectId?: string) {
    this.db = new Firestore({
      projectId: projectId || process.env.FIREBASE_PROJECT_ID,
      ignoreUndefinedProperties: true,
    });
  }

  // Captures
  async saveCapture(capture: Capture, username: string = 'default'): Promise<void> {
    const safeTimestamp = capture.timestamp.replace(/:/g, '-').replace(/\./g, '-');
    const docId = `${safeTimestamp}_${capture.id}`;
    await this.db.collection('captures').doc(username).collection('items').doc(docId).set(capture);
  }

  async getCapture(id: string, username?: string): Promise<Capture | null> {
    // Query user's subcollection directly when username is known (avoids collection group index)
    const collection = username
      ? this.db.collection('captures').doc(username).collection('items')
      : this.db.collectionGroup('items');
    const snapshot = await collection
      .where('id', '==', id)
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    return snapshot.docs[0].data() as Capture;
  }

  async updateCapture(capture: Capture): Promise<void> {
    const username = capture.username || 'default';
    const snapshot = await this.db.collection('captures').doc(username).collection('items')
      .where('id', '==', capture.id)
      .limit(1)
      .get();

    if (snapshot.empty) {
      await this.saveCapture(capture, capture.username || 'default');
      return;
    }

    await snapshot.docs[0].ref.set(capture);
  }

  async listCaptures(limit: number = 50, username?: string): Promise<Capture[]> {
    const captures = await this.listAllCaptures(username);
    return captures
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  async listAllCaptures(username?: string): Promise<Capture[]> {
    if (username) {
      const snapshot = await this.db.collection('captures').doc(username).collection('items').get();
      return snapshot.docs.map(doc => doc.data() as Capture);
    }

    const snapshot = await this.db.collectionGroup('items').get();
    return snapshot.docs.map(doc => doc.data() as Capture);
  }

  async listCapturesNeedingAuth(username?: string): Promise<Capture[]> {
    const captures = await this.listAllCaptures(username);
    return captures.filter(c =>
      c.executionResult === 'blocked_needs_auth' ||
      c.executionResult === 'blocked_auth_expired'
    );
  }

  // Routes
  async saveRoute(route: Route): Promise<void> {
    await this.db.collection('routes').doc(route.id).set(route);
  }

  async deleteRoute(id: string): Promise<void> {
    await this.db.collection('routes').doc(id).delete();
  }

  async getRoute(id: string): Promise<Route | null> {
    const doc = await this.db.collection('routes').doc(id).get();
    if (!doc.exists) return null;
    return doc.data() as Route;
  }

  async listRoutes(): Promise<Route[]> {
    const snapshot = await this.db.collection('routes').get();
    const routes = snapshot.docs.map(doc => doc.data() as Route);
    return routes.filter(r => r.destinationType !== 'fs');
  }

  async getRouteByName(name: string): Promise<Route | null> {
    const routes = await this.listRoutes();
    return routes.find(r => r.name === name) || null;
  }

  // Execution traces
  async saveExecutionTrace(captureId: string, trace: ExecutionStep[]): Promise<void> {
    await this.db.collection('executions').doc(captureId).set({ captureId, trace });
  }

  // Config
  async getConfig(): Promise<Config> {
    const doc = await this.db.collection('config').doc('main').get();
    if (!doc.exists) {
      const defaultConfig: Config = {
        authToken: 'dev-token',
        requireApproval: false,
        approvalGuardPrompt: null,
        mastermindRetryAttempts: 3,
      };
      await this.db.collection('config').doc('main').set(defaultConfig);
      return defaultConfig;
    }
    return doc.data() as Config;
  }

  async saveConfig(config: Config): Promise<void> {
    await this.db.collection('config').doc('main').set(config);
  }

  // Inbox
  async appendToInbox(entry: string): Promise<void> {
    await this.db.collection('inbox').add({
      timestamp: new Date().toISOString(),
      entry,
    });
  }

  // Evolver test cases
  async saveEvolverTestCase(testCase: EvolverTestCase): Promise<void> {
    await this.db.collection('evolver-tests').doc(testCase.id).set(testCase);
  }

  async getEvolverTestCase(id: string): Promise<EvolverTestCase | null> {
    const doc = await this.db.collection('evolver-tests').doc(id).get();
    if (!doc.exists) return null;
    return doc.data() as EvolverTestCase;
  }

  async listEvolverTestCases(): Promise<EvolverTestCase[]> {
    const snapshot = await this.db.collection('evolver-tests').get();
    return snapshot.docs.map(doc => doc.data() as EvolverTestCase);
  }

  async deleteEvolverTestCase(id: string): Promise<void> {
    await this.db.collection('evolver-tests').doc(id).delete();
  }

  async pruneEvolverTestCases(keepRecent: number = 5): Promise<void> {
    const allCases = await this.listEvolverTestCases();
    const nonRatchetCases = allCases.filter(tc => !tc.isRatchetCase);
    nonRatchetCases.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    const toDelete = nonRatchetCases.slice(keepRecent);
    for (const tc of toDelete) {
      await this.deleteEvolverTestCase(tc.id);
    }
  }

  // Per-user tokens
  async saveIntendTokens(username: string, tokens: IntendTokens): Promise<void> {
    await this.db.collection('users').doc(username).set(
      { integrations: { intend: tokens } },
      { merge: true }
    );
  }

  async getIntendTokens(username: string): Promise<IntendTokens | null> {
    const doc = await this.db.collection('users').doc(username).get();
    if (!doc.exists) return null;
    const data = doc.data();
    return data?.integrations?.intend || null;
  }

  async clearIntendTokens(username: string): Promise<void> {
    const doc = await this.db.collection('users').doc(username).get();
    if (!doc.exists) return;
    const data = doc.data() || {};
    if (data.integrations) {
      delete data.integrations.intend;
      await this.db.collection('users').doc(username).set(data);
    }
  }

  async saveSheetsTokens(username: string, tokens: SheetsTokens): Promise<void> {
    await this.db.collection('users').doc(username).set(
      { integrations: { sheets: tokens } },
      { merge: true }
    );
  }

  async getSheetsTokens(username: string): Promise<SheetsTokens | null> {
    const doc = await this.db.collection('users').doc(username).get();
    if (!doc.exists) return null;
    const data = doc.data();
    return data?.integrations?.sheets || null;
  }

  async clearSheetsTokens(username: string): Promise<void> {
    const doc = await this.db.collection('users').doc(username).get();
    if (!doc.exists) return;
    const data = doc.data() || {};
    if (data.integrations) {
      delete data.integrations.sheets;
      await this.db.collection('users').doc(username).set(data);
    }
  }

  async getRoamConfig(username: string): Promise<RoamConfig | null> {
    const doc = await this.db.collection('users').doc(username).get();
    if (!doc.exists) return null;
    const data = doc.data();
    return data?.integrations?.roam || null;
  }

  async saveRoamConfig(username: string, config: RoamConfig): Promise<void> {
    await this.db.collection('users').doc(username).set(
      { integrations: { roam: config } },
      { merge: true },
    );
  }

  async clearRoamConfig(username: string): Promise<void> {
    const { FieldValue } = await import('@google-cloud/firestore');
    await this.db.collection('users').doc(username).update({
      'integrations.roam': FieldValue.delete(),
    });
  }

  // Integration notes
  async getIntegrationNote(username: string, integrationId: string): Promise<string | null> {
    const doc = await this.db.collection('users').doc(username)
      .collection('notes').doc(`integration-${integrationId}`).get();
    if (!doc.exists) return null;
    return doc.data()?.content || null;
  }

  async saveIntegrationNote(username: string, integrationId: string, content: string): Promise<void> {
    await this.db.collection('users').doc(username)
      .collection('notes').doc(`integration-${integrationId}`)
      .set({ content });
  }

  // Destination notes
  async getDestinationNote(username: string, destinationId: string): Promise<string | null> {
    const safeId = destinationId.replace(/[/\\:*?"<>|]/g, '_');
    const doc = await this.db.collection('users').doc(username)
      .collection('notes').doc(`destination-${safeId}`).get();
    if (!doc.exists) return null;
    return doc.data()?.content || null;
  }

  async saveDestinationNote(username: string, destinationId: string, content: string): Promise<void> {
    const safeId = destinationId.replace(/[/\\:*?"<>|]/g, '_');
    await this.db.collection('users').doc(username)
      .collection('notes').doc(`destination-${safeId}`)
      .set({ content });
  }

  // Hygiene signals
  async appendHygieneSignal(signal: HygieneSignal): Promise<void> {
    await this.db.collection('hygiene-signals').add(signal);
  }

  async getHygieneSignals(): Promise<HygieneSignal[]> {
    const snapshot = await this.db.collection('hygiene-signals').get();
    return snapshot.docs.map(doc => doc.data() as HygieneSignal);
  }

  async getHygieneSignalsForRoute(routeId: string): Promise<HygieneSignal[]> {
    const snapshot = await this.db.collection('hygiene-signals')
      .where('routeId', '==', routeId).get();
    return snapshot.docs.map(doc => doc.data() as HygieneSignal);
  }

  // Trigger change reviews
  async saveTriggerReview(review: TriggerChangeReview): Promise<void> {
    await this.db.collection('trigger-reviews').doc(review.id).set(review);
  }

  async getTriggerReview(id: string): Promise<TriggerChangeReview | null> {
    const doc = await this.db.collection('trigger-reviews').doc(id).get();
    if (!doc.exists) return null;
    return doc.data() as TriggerChangeReview;
  }

  async listTriggerReviews(status?: TriggerChangeReview['status']): Promise<TriggerChangeReview[]> {
    let query: FirebaseFirestore.Query = this.db.collection('trigger-reviews');
    if (status) {
      query = query.where('status', '==', status);
    }
    const snapshot = await query.get();
    return snapshot.docs.map(doc => doc.data() as TriggerChangeReview);
  }

  async updateTriggerReviewStatus(id: string, status: 'approved' | 'rejected'): Promise<boolean> {
    const review = await this.getTriggerReview(id);
    if (!review) return false;
    review.status = status;
    await this.saveTriggerReview(review);
    return true;
  }

  async deleteTriggerReview(id: string): Promise<void> {
    await this.db.collection('trigger-reviews').doc(id).delete();
  }

  // User management
  async saveUser(profile: UserProfile): Promise<void> {
    await this.db.collection('users').doc(profile.uid).set(profile, { merge: true });
  }

  async getUser(uid: string): Promise<UserProfile | null> {
    const doc = await this.db.collection('users').doc(uid).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (!data?.email) return null;
    return data as UserProfile;
  }

  // API key management
  async saveApiKey(uid: string, key: ApiKey): Promise<void> {
    await this.db.collection('users').doc(uid).collection('apiKeys').doc(key.id).set(key);
  }

  async listApiKeys(uid: string): Promise<ApiKey[]> {
    const snapshot = await this.db.collection('users').doc(uid).collection('apiKeys').get();
    return snapshot.docs.map(doc => doc.data() as ApiKey);
  }

  async getApiKey(uid: string, keyId: string): Promise<ApiKey | null> {
    const doc = await this.db.collection('users').doc(uid).collection('apiKeys').doc(keyId).get();
    if (!doc.exists) return null;
    return doc.data() as ApiKey;
  }

  async updateApiKey(uid: string, key: ApiKey): Promise<void> {
    await this.db.collection('users').doc(uid).collection('apiKeys').doc(key.id).set(key);
  }

  async deleteApiKey(uid: string, keyId: string): Promise<void> {
    await this.db.collection('users').doc(uid).collection('apiKeys').doc(keyId).delete();
  }

  // API key index
  async saveApiKeyIndex(keyHash: string, uid: string, keyId: string): Promise<void> {
    await this.db.collection('apiKeyIndex').doc(keyHash).set({ uid, keyId });
  }

  async getApiKeyIndex(keyHash: string): Promise<{ uid: string; keyId: string } | null> {
    const doc = await this.db.collection('apiKeyIndex').doc(keyHash).get();
    if (!doc.exists) return null;
    return doc.data() as { uid: string; keyId: string };
  }

  async deleteApiKeyIndex(keyHash: string): Promise<void> {
    await this.db.collection('apiKeyIndex').doc(keyHash).delete();
  }
}
