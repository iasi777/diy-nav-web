import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { config } from '@nav/config'

export type SqliteDatabase = Database.Database

let database: SqliteDatabase | undefined

export const nowIso = (): string => new Date().toISOString()
export const createId = (): string => randomUUID()

export function getDatabase(): SqliteDatabase {
  if (database) return database

  const databasePath = resolve(config.localDatabase.path)
  mkdirSync(dirname(databasePath), { recursive: true })
  database = new Database(databasePath)
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  database.pragma('busy_timeout = 5000')
  migrate(database)
  return database
}

export function closeDatabase(): void {
  database?.close()
  database = undefined
}

export function migrate(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)

  const applied = new Set(
    (
      db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
        version: number
      }>
    ).map(row => row.version)
  )

  if (!applied.has(1)) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE categories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE,
          description TEXT,
          icon TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE tags (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE,
          color TEXT NOT NULL DEFAULT '#3B82F6',
          sort_order INTEGER NOT NULL DEFAULT 0,
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE bookmarks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          normalized_url TEXT NOT NULL UNIQUE,
          description TEXT,
          category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
          favicon TEXT,
          visit_count INTEGER NOT NULL DEFAULT 0,
          last_visited TEXT,
          is_favorite INTEGER NOT NULL DEFAULT 0,
          is_online INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0,
          favorite_order INTEGER,
          version INTEGER NOT NULL DEFAULT 1,
          source_import_item_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX bookmarks_category_idx ON bookmarks(category_id);
        CREATE INDEX bookmarks_sort_idx ON bookmarks(sort_order);

        CREATE TABLE bookmark_tags (
          bookmark_id TEXT NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
          tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY (bookmark_id, tag_id)
        );

        CREATE TABLE import_batches (
          id TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          format TEXT NOT NULL,
          status TEXT NOT NULL,
          taxonomy_json TEXT NOT NULL DEFAULT '[]',
          selected_model TEXT,
          total_items INTEGER NOT NULL DEFAULT 0,
          processed_items INTEGER NOT NULL DEFAULT 0,
          error_message TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE import_items (
          id TEXT PRIMARY KEY,
          batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
          source_index INTEGER NOT NULL,
          title TEXT NOT NULL,
          url TEXT NOT NULL,
          normalized_url TEXT,
          folder_path TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL,
          duplicate_bookmark_id TEXT REFERENCES bookmarks(id) ON DELETE SET NULL,
          category_name TEXT,
          tags_json TEXT NOT NULL DEFAULT '[]',
          description TEXT,
          error_message TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(batch_id, source_index)
        );

        CREATE INDEX import_items_batch_idx ON import_items(batch_id, source_index);
        CREATE INDEX import_items_status_idx ON import_items(batch_id, status);

        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL
        );
      `)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        1,
        nowIso()
      )
    })()
  }

  if (!applied.has(2)) {
    db.transaction(() => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS bookmarks_updated_idx ON bookmarks(updated_at DESC);
        CREATE INDEX IF NOT EXISTS bookmark_tags_tag_idx ON bookmark_tags(tag_id, bookmark_id);
        CREATE INDEX IF NOT EXISTS import_batches_status_idx ON import_batches(status, updated_at);
      `)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        2,
        nowIso()
      )
    })()
  }
}

interface CategoryRow {
  id: string
  name: string
  description: string | null
  icon: string | null
  sort_order: number
  version: number
  created_at: string
  updated_at: string
  website_count: number
}

interface TagRow {
  id: string
  name: string
  color: string
  sort_order: number
  version: number
  created_at: string
  updated_at: string
  usage_count: number
}

interface BookmarkRow {
  id: string
  name: string
  url: string
  description: string | null
  category_id: string | null
  favicon: string | null
  visit_count: number
  last_visited: string | null
  is_favorite: number
  is_online: number
  sort_order: number
  favorite_order: number | null
  version: number
  created_at: string
  updated_at: string
}

export interface ApiCategory {
  id: string
  name: string
  description?: string
  icon?: string
  order: number
  websiteCount: number
  version: number
  createdAt: string
  updatedAt: string
}

export interface ApiTag {
  id: string
  name: string
  color: string
  order: number
  usageCount: number
  version: number
  createdAt: string
  updatedAt: string
}

export interface ApiBookmark {
  id: string
  name: string
  url: string
  description?: string
  categoryId: string
  tagIds: string[]
  favicon?: string
  visitCount: number
  lastVisited?: string
  isFavorite: boolean
  isOnline: boolean
  order: number
  favoriteOrder?: number
  version: number
  createdAt: string
  updatedAt: string
}

export function listCategories(db = getDatabase()): ApiCategory[] {
  const rows = db
    .prepare(
      `SELECT c.*, COUNT(b.id) AS website_count
       FROM categories c
       LEFT JOIN bookmarks b ON b.category_id = c.id
       GROUP BY c.id
       ORDER BY c.sort_order, c.name`
    )
    .all() as CategoryRow[]
  return rows.map(mapCategory)
}

export function getCategory(id: string, db = getDatabase()): ApiCategory | undefined {
  const row = db
    .prepare(
      `SELECT c.*, COUNT(b.id) AS website_count
       FROM categories c
       LEFT JOIN bookmarks b ON b.category_id = c.id
       WHERE c.id = ?
       GROUP BY c.id`
    )
    .get(id) as CategoryRow | undefined
  return row ? mapCategory(row) : undefined
}

export function listTags(db = getDatabase()): ApiTag[] {
  const rows = db
    .prepare(
      `SELECT t.*, COUNT(bt.bookmark_id) AS usage_count
       FROM tags t
       LEFT JOIN bookmark_tags bt ON bt.tag_id = t.id
       GROUP BY t.id
       ORDER BY t.sort_order, t.name`
    )
    .all() as TagRow[]
  return rows.map(mapTag)
}

export function getTag(id: string, db = getDatabase()): ApiTag | undefined {
  const row = db
    .prepare(
      `SELECT t.*, COUNT(bt.bookmark_id) AS usage_count
       FROM tags t
       LEFT JOIN bookmark_tags bt ON bt.tag_id = t.id
       WHERE t.id = ?
       GROUP BY t.id`
    )
    .get(id) as TagRow | undefined
  return row ? mapTag(row) : undefined
}

export function listBookmarks(db = getDatabase()): ApiBookmark[] {
  const rows = db
    .prepare('SELECT * FROM bookmarks ORDER BY sort_order, created_at')
    .all() as BookmarkRow[]
  const tagRows = db
    .prepare('SELECT bookmark_id, tag_id FROM bookmark_tags ORDER BY tag_id')
    .all() as Array<{ bookmark_id: string; tag_id: string }>
  const tagsByBookmark = new Map<string, string[]>()
  for (const row of tagRows) {
    const tags = tagsByBookmark.get(row.bookmark_id) ?? []
    tags.push(row.tag_id)
    tagsByBookmark.set(row.bookmark_id, tags)
  }
  return rows.map(row => mapBookmark(row, tagsByBookmark.get(row.id) ?? []))
}

export function getBookmark(id: string, db = getDatabase()): ApiBookmark | undefined {
  const row = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(id) as BookmarkRow | undefined
  if (!row) return undefined
  const tags = db
    .prepare('SELECT tag_id FROM bookmark_tags WHERE bookmark_id = ? ORDER BY tag_id')
    .all(id) as Array<{ tag_id: string }>
  return mapBookmark(
    row,
    tags.map(tag => tag.tag_id)
  )
}

function mapCategory(row: CategoryRow): ApiCategory {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    icon: row.icon ?? undefined,
    order: row.sort_order,
    websiteCount: row.website_count,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapTag(row: TagRow): ApiTag {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    order: row.sort_order,
    usageCount: row.usage_count,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapBookmark(row: BookmarkRow, tagIds: string[]): ApiBookmark {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    description: row.description ?? undefined,
    categoryId: row.category_id ?? '',
    tagIds,
    favicon: row.favicon ?? undefined,
    visitCount: row.visit_count,
    lastVisited: row.last_visited ?? undefined,
    isFavorite: row.is_favorite === 1,
    isOnline: row.is_online === 1,
    order: row.sort_order,
    favoriteOrder: row.favorite_order ?? undefined,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
