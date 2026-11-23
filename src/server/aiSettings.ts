import type { Env } from './env'
import {
  providerFromSettings,
  resolveProvider,
  type Provider,
  type ProviderId,
} from './providers.ts'
import type { SqlDatabase } from './sql'

export type StoredKey = {
  provider: ProviderId
  model: string
  baseUrl: string
  apiKey: string
  updatedAt: number
}

type Row = {
  provider: string
  model: string
  base_url: string
  api_key: string
  updated_at: number
}

export async function readAiKey(
  db: SqlDatabase,
  owner: string,
): Promise<StoredKey | null> {
  const row = await db
    .prepare(
      'SELECT provider, model, base_url, api_key, updated_at FROM ai_keys WHERE owner_sub = ?',
    )
    .bind(owner)
    .first<Row>()
  if (!row) return null
  return {
    provider: row.provider as ProviderId,
    model: row.model,
    baseUrl: row.base_url,
    apiKey: row.api_key,
    updatedAt: row.updated_at,
  }
}

export async function saveAiKey(
  db: SqlDatabase,
  owner: string,
  key: { provider: ProviderId; model: string; baseUrl: string; apiKey: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ai_keys (owner_sub, provider, model, base_url, api_key, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_sub) DO UPDATE SET provider = excluded.provider,
         model = excluded.model, base_url = excluded.base_url,
         api_key = excluded.api_key, updated_at = excluded.updated_at`,
    )
    .bind(owner, key.provider, key.model, key.baseUrl, key.apiKey, Date.now())
    .run()
}

export async function clearAiKey(
  db: SqlDatabase,
  owner: string,
): Promise<void> {
  await db.prepare('DELETE FROM ai_keys WHERE owner_sub = ?').bind(owner).run()
}

/**
 * The student's own key wins over the deployment's; neither is ever sent to
 * the browser. A saved key that no longer builds (a service removed, a URL
 * cleared) falls back to the deployment's provider instead of failing.
 */
export async function effectiveProvider(
  db: SqlDatabase,
  env: Env,
  owner: string,
): Promise<{ provider: Provider | null; source: 'account' | 'server' | null }> {
  const stored = await readAiKey(db, owner)
  if (stored) {
    const provider = providerFromSettings(stored)
    if (provider) return { provider, source: 'account' }
  }
  const provider = resolveProvider(env)
  return provider ? { provider, source: 'server' } : { provider: null, source: null }
}
