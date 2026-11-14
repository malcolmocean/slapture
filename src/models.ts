import Anthropic from '@anthropic-ai/sdk';

/**
 * Model IDs are resolved at runtime, so a retired model does not break captures again.
 *
 * Anthropic has no "-latest" alias that follows new generations. This module does the
 * same job: it asks the Models API for the newest model of a family and caches the answer.
 *
 * Order: env override (SLAPTURE_MODEL_SONNET / _HAIKU / _OPUS) > Models API > FALLBACK.
 */
export type ModelFamily = 'opus' | 'sonnet' | 'haiku';

const FALLBACK: Record<ModelFamily, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
};

const TTL_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;

let cache: { expires: number; ids: Partial<Record<ModelFamily, string>> } | null = null;
let inflight: Promise<Partial<Record<ModelFamily, string>>> | null = null;

async function fetchNewest(apiKey: string): Promise<Partial<Record<ModelFamily, string>>> {
  const client = new Anthropic({ apiKey });
  const newest: Partial<Record<ModelFamily, { id: string; created: number }>> = {};
  for await (const m of client.models.list({ limit: 1000 })) {
    const match = /^claude-(opus|sonnet|haiku)-/.exec(m.id);
    if (!match) continue;
    const family = match[1] as ModelFamily;
    const created = Date.parse(m.created_at);
    const current = newest[family];
    if (!current || created > current.created) newest[family] = { id: m.id, created };
  }
  const ids: Partial<Record<ModelFamily, string>> = {};
  for (const f of Object.keys(newest) as ModelFamily[]) ids[f] = newest[f]!.id;
  return ids;
}

export async function latestModel(family: ModelFamily, apiKey: string): Promise<string> {
  const override = process.env[`SLAPTURE_MODEL_${family.toUpperCase()}`];
  if (override) return override;
  // No network lookups without a key or under test.
  if (!apiKey || process.env.VITEST) return FALLBACK[family];

  if (!cache || Date.now() > cache.expires) {
    inflight ??= fetchNewest(apiKey).finally(() => { inflight = null; });
    try {
      const ids = await inflight;
      cache = { expires: Date.now() + TTL_MS, ids };
      console.log('[Models] Resolved newest models:', JSON.stringify(ids));
    } catch (error) {
      console.error('[Models] Lookup failed, using fallback IDs:', error);
      cache = { expires: Date.now() + RETRY_MS, ids: cache?.ids ?? {} };
    }
  }
  return cache.ids[family] ?? FALLBACK[family];
}
