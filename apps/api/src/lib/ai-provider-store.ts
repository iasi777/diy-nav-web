import type { D1Client } from '@nav/database'
import type { AIProviderConfig } from '@nav/ai-core'

type AIProviderRow = {
  id: string
  user_id: string
  name: string
  type: AIProviderConfig['type']
  api_key_encrypted: string
  base_url: string | null
  model: string | null
  is_default: number
  created_at: number
  updated_at: number
}

const mapRowToConfig = (row: AIProviderRow): AIProviderConfig => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  type: row.type,
  apiKeyEncrypted: row.api_key_encrypted,
  baseUrl: row.base_url ?? undefined,
  model: row.model ?? undefined,
  isDefault: row.is_default === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

/**
 * Initialize AI provider table if it doesn't exist
 */
export const initAIProviderTable = async (d1: D1Client): Promise<void> => {
  await d1.query(`
    CREATE TABLE IF NOT EXISTS ai_providers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      api_key_encrypted TEXT NOT NULL,
      base_url TEXT,
      model TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  await d1.query(`CREATE INDEX IF NOT EXISTS idx_ai_providers_user_id ON ai_providers(user_id);`)
}

export const listUserProviders = async (
  d1: D1Client,
  userId: string
): Promise<AIProviderConfig[]> => {
  const rows = await d1.all<AIProviderRow>(
    `SELECT * FROM ai_providers WHERE user_id = ? ORDER BY created_at DESC`,
    [userId]
  )
  return rows.map(mapRowToConfig)
}

export const findUserProviderById = async (
  d1: D1Client,
  userId: string,
  id: string
): Promise<AIProviderConfig | null> => {
  const row = await d1.first<AIProviderRow>(
    `SELECT * FROM ai_providers WHERE user_id = ? AND id = ?`,
    [userId, id]
  )
  return row ? mapRowToConfig(row) : null
}

export const findUserDefaultProvider = async (
  d1: D1Client,
  userId: string
): Promise<AIProviderConfig | null> => {
  const row = await d1.first<AIProviderRow>(
    `SELECT * FROM ai_providers WHERE user_id = ? AND is_default = 1 LIMIT 1`,
    [userId]
  )
  return row ? mapRowToConfig(row) : null
}

export const findUserFirstProvider = async (
  d1: D1Client,
  userId: string
): Promise<AIProviderConfig | null> => {
  const row = await d1.first<AIProviderRow>(
    `SELECT * FROM ai_providers WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
    [userId]
  )
  return row ? mapRowToConfig(row) : null
}

export const createProvider = async (d1: D1Client, provider: AIProviderConfig): Promise<void> => {
  if (provider.isDefault) {
    await d1.query(`UPDATE ai_providers SET is_default = 0 WHERE user_id = ?`, [provider.userId])
  }

  await d1.query(
    `INSERT INTO ai_providers (id, user_id, name, type, api_key_encrypted, base_url, model, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      provider.id,
      provider.userId,
      provider.name,
      provider.type,
      provider.apiKeyEncrypted,
      provider.baseUrl ?? null,
      provider.model ?? null,
      provider.isDefault ? 1 : 0,
      provider.createdAt,
      provider.updatedAt
    ]
  )
}

export const deleteProvider = async (
  d1: D1Client,
  userId: string,
  id: string
): Promise<boolean> => {
  const existing = await findUserProviderById(d1, userId, id)
  if (!existing) return false

  await d1.query(`DELETE FROM ai_providers WHERE user_id = ? AND id = ?`, [userId, id])
  return true
}

export const updateProvider = async (
  d1: D1Client,
  provider: AIProviderConfig
): Promise<boolean> => {
  const existing = await findUserProviderById(d1, provider.userId, provider.id)
  if (!existing) return false

  if (provider.isDefault) {
    await d1.query(`UPDATE ai_providers SET is_default = 0 WHERE user_id = ?`, [provider.userId])
  }

  await d1.query(
    `UPDATE ai_providers
     SET name = ?, type = ?, api_key_encrypted = ?, base_url = ?, model = ?, is_default = ?, updated_at = ?
     WHERE user_id = ? AND id = ?`,
    [
      provider.name,
      provider.type,
      provider.apiKeyEncrypted,
      provider.baseUrl ?? null,
      provider.model ?? null,
      provider.isDefault ? 1 : 0,
      provider.updatedAt,
      provider.userId,
      provider.id
    ]
  )
  return true
}
