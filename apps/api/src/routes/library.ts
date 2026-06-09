import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  createId,
  getBookmark,
  getCategory,
  getDatabase,
  getTag,
  listBookmarks,
  listCategories,
  listTags,
  nowIso
} from '../lib/sqlite.js'
import { normalizeUrl } from '../lib/bookmark-import.js'

const versionSchema = z.object({ version: z.coerce.number().int().positive() })
const versionedItemsSchema = z
  .array(z.object({ id: z.string().uuid(), version: z.number().int().positive() }))
  .min(1)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, {
    message: 'Duplicate item ids are not allowed'
  })
const bulkDeleteSchema = z.object({ items: versionedItemsSchema })
const reorderSchema = z.object({
  items: versionedItemsSchema,
  favorite: z.boolean().optional()
})
const categoryBodySchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(240).optional(),
  icon: z.string().trim().max(100).optional()
})
const tagBodySchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-f]{6}$/i)
})
const bookmarkBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(2048),
  description: z.string().trim().max(500).optional(),
  categoryId: z.string().uuid().or(z.literal('')).optional(),
  tagIds: z.array(z.string().uuid()).max(20).default([]),
  favicon: z.string().trim().max(2048).optional(),
  isFavorite: z.boolean().optional(),
  isOnline: z.boolean().optional(),
  favoriteOrder: z.number().int().nonnegative().nullable().optional()
})

const libraryRoutes: FastifyPluginAsync = async app => {
  const db = getDatabase()

  app.get('/bookmarks', async () => ({ success: true, data: listBookmarks(db) }))
  app.get('/categories', async () => ({ success: true, data: listCategories(db) }))
  app.get('/tags', async () => ({ success: true, data: listTags(db) }))

  app.post('/bookmarks', async (request, reply) => {
    const body = bookmarkBodySchema.parse(request.body)
    const id = createId()
    const now = nowIso()
    const normalizedUrl = normalizeUrl(body.url)
    const order = (
      db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM bookmarks').get() as {
        value: number
      }
    ).value

    try {
      db.transaction(() => {
        db.prepare(
          `INSERT INTO bookmarks (
             id, name, url, normalized_url, description, category_id, favicon,
             is_favorite, is_online, sort_order, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          body.name,
          body.url,
          normalizedUrl,
          body.description ?? null,
          body.categoryId || null,
          body.favicon ?? null,
          body.isFavorite ? 1 : 0,
          body.isOnline === false ? 0 : 1,
          order,
          now,
          now
        )
        replaceBookmarkTags(db, id, body.tagIds)
      })()
    } catch (error) {
      return sendConstraintError(reply, error, 'A bookmark with this URL already exists')
    }
    return reply.code(201).send({ success: true, data: getBookmark(id, db) })
  })

  app.patch('/bookmarks/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = bookmarkBodySchema.partial().merge(versionSchema).parse(request.body)
    const existing = getBookmark(id, db)
    if (!existing) return reply.code(404).send(notFound('Bookmark'))
    if (existing.version !== body.version) return sendConflict(reply, existing)

    const next = { ...existing, ...body }
    const now = nowIso()
    try {
      const result = db.transaction(() => {
        const update = db
          .prepare(
            `UPDATE bookmarks SET
               name = ?, url = ?, normalized_url = ?, description = ?, category_id = ?,
               favicon = ?, is_favorite = ?, is_online = ?, favorite_order = ?,
               version = version + 1,
               updated_at = ?
             WHERE id = ? AND version = ?`
          )
          .run(
            next.name,
            next.url,
            normalizeUrl(next.url),
            next.description ?? null,
            next.categoryId || null,
            next.favicon ?? null,
            next.isFavorite ? 1 : 0,
            next.isOnline ? 1 : 0,
            next.favoriteOrder ?? null,
            now,
            id,
            body.version
          )
        if (update.changes === 0) return false
        if (body.tagIds) replaceBookmarkTags(db, id, body.tagIds)
        return true
      })()
      if (!result) return sendConflict(reply, getBookmark(id, db))
    } catch (error) {
      return sendConstraintError(reply, error, 'A bookmark with this URL already exists')
    }
    return { success: true, data: getBookmark(id, db) }
  })

  app.post('/bookmarks/:id/visit', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = versionSchema.parse(request.body)
    const visitedAt = nowIso()
    const result = db
      .prepare(
        `UPDATE bookmarks SET visit_count = visit_count + 1, last_visited = ?,
         updated_at = ?, version = version + 1 WHERE id = ? AND version = ?`
      )
      .run(visitedAt, visitedAt, id, body.version)
    if (result.changes === 0) return sendConflict(reply, getBookmark(id, db))
    return { success: true, data: getBookmark(id, db) }
  })

  app.delete('/bookmarks/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { version } = versionSchema.parse(request.query)
    if (!deleteLibraryItems(db, 'bookmarks', [{ id, version }])) {
      return sendConflict(reply, getBookmark(id, db))
    }
    return { success: true }
  })

  app.post('/bookmarks/bulk-delete', async (request, reply) => {
    const { items } = bulkDeleteSchema.parse(request.body)
    if (!deleteLibraryItems(db, 'bookmarks', items)) {
      return sendConflict(reply, listBookmarks(db))
    }
    return { success: true }
  })

  app.post('/bookmarks/reorder', async (request, reply) => {
    const body = reorderSchema.parse(request.body)
    const now = nowIso()
    const orderColumn = body.favorite ? 'favorite_order' : 'sort_order'
    const changed = db.transaction(() => {
      if (!versionsMatch(db, 'bookmarks', body.items)) return false
      for (const [order, item] of body.items.entries()) {
        const result = db
          .prepare(
            `UPDATE bookmarks SET ${orderColumn} = ?, version = version + 1,
             updated_at = ? WHERE id = ? AND version = ?`
          )
          .run(order, now, item.id, item.version)
        if (result.changes !== 1) return false
      }
      return true
    })()
    if (!changed) return sendConflict(reply, listBookmarks(db))
    return { success: true, data: listBookmarks(db) }
  })

  app.post('/categories', async (request, reply) => {
    const body = categoryBodySchema.parse(request.body)
    const id = createId()
    const now = nowIso()
    const order = nextOrder(db, 'categories')
    try {
      db.prepare(
        'INSERT INTO categories (id, name, description, icon, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, body.name, body.description ?? null, body.icon ?? null, order, now, now)
    } catch (error) {
      return sendConstraintError(reply, error, 'A category with this name already exists')
    }
    return reply.code(201).send({ success: true, data: getCategory(id, db) })
  })

  app.patch('/categories/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = categoryBodySchema.partial().merge(versionSchema).parse(request.body)
    const current = getCategory(id, db)
    if (!current) return reply.code(404).send(notFound('Category'))
    if (current.version !== body.version) return sendConflict(reply, current)
    try {
      const result = db
        .prepare(
          `UPDATE categories SET name = ?, description = ?, icon = ?,
           version = version + 1, updated_at = ? WHERE id = ? AND version = ?`
        )
        .run(
          body.name ?? current.name,
          body.description ?? current.description ?? null,
          body.icon ?? current.icon ?? null,
          nowIso(),
          id,
          body.version
        )
      if (result.changes === 0) return sendConflict(reply, getCategory(id, db))
    } catch (error) {
      return sendConstraintError(reply, error, 'A category with this name already exists')
    }
    return { success: true, data: getCategory(id, db) }
  })

  app.delete('/categories/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { version } = versionSchema.parse(request.query)
    if (!deleteLibraryItems(db, 'categories', [{ id, version }])) {
      return sendConflict(reply, getCategory(id, db))
    }
    return { success: true }
  })

  app.post('/categories/bulk-delete', async (request, reply) => {
    const { items } = bulkDeleteSchema.parse(request.body)
    if (!deleteLibraryItems(db, 'categories', items)) {
      return sendConflict(reply, listCategories(db))
    }
    return { success: true }
  })

  app.post('/categories/reorder', async (request, reply) => {
    const body = reorderSchema.parse(request.body)
    if (!reorderRows(db, 'categories', body.items)) return sendConflict(reply, listCategories(db))
    return { success: true, data: listCategories(db) }
  })

  app.post('/tags', async (request, reply) => {
    const body = tagBodySchema.parse(request.body)
    const id = createId()
    const now = nowIso()
    try {
      db.prepare(
        'INSERT INTO tags (id, name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, body.name, body.color, nextOrder(db, 'tags'), now, now)
    } catch (error) {
      return sendConstraintError(reply, error, 'A tag with this name already exists')
    }
    return reply.code(201).send({ success: true, data: getTag(id, db) })
  })

  app.patch('/tags/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = tagBodySchema.partial().merge(versionSchema).parse(request.body)
    const current = getTag(id, db)
    if (!current) return reply.code(404).send(notFound('Tag'))
    if (current.version !== body.version) return sendConflict(reply, current)
    try {
      const result = db
        .prepare(
          `UPDATE tags SET name = ?, color = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND version = ?`
        )
        .run(body.name ?? current.name, body.color ?? current.color, nowIso(), id, body.version)
      if (result.changes === 0) return sendConflict(reply, getTag(id, db))
    } catch (error) {
      return sendConstraintError(reply, error, 'A tag with this name already exists')
    }
    return { success: true, data: getTag(id, db) }
  })

  app.delete('/tags/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { version } = versionSchema.parse(request.query)
    if (!deleteLibraryItems(db, 'tags', [{ id, version }])) {
      return sendConflict(reply, getTag(id, db))
    }
    return { success: true }
  })

  app.post('/tags/bulk-delete', async (request, reply) => {
    const { items } = bulkDeleteSchema.parse(request.body)
    if (!deleteLibraryItems(db, 'tags', items)) {
      return sendConflict(reply, listTags(db))
    }
    return { success: true }
  })

  app.post('/tags/reorder', async (request, reply) => {
    const body = reorderSchema.parse(request.body)
    if (!reorderRows(db, 'tags', body.items)) return sendConflict(reply, listTags(db))
    return { success: true, data: listTags(db) }
  })
}

function replaceBookmarkTags(
  db: ReturnType<typeof getDatabase>,
  bookmarkId: string,
  tagIds: string[]
): void {
  db.prepare('DELETE FROM bookmark_tags WHERE bookmark_id = ?').run(bookmarkId)
  const insert = db.prepare('INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)')
  for (const tagId of [...new Set(tagIds)]) insert.run(bookmarkId, tagId)
}

function nextOrder(db: ReturnType<typeof getDatabase>, table: 'categories' | 'tags'): number {
  return (
    db.prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM ${table}`).get() as {
      value: number
    }
  ).value
}

function deleteLibraryItems(
  db: ReturnType<typeof getDatabase>,
  table: 'bookmarks' | 'categories' | 'tags',
  items: Array<{ id: string; version: number }>
): boolean {
  try {
    db.transaction(() => {
      if (!versionsMatch(db, table, items)) throw new VersionConflictError()

      const ids = items.map(item => item.id)
      const placeholders = ids.map(() => '?').join(', ')
      const now = nowIso()

      if (table === 'categories') {
        db.prepare(
          `UPDATE bookmarks SET category_id = NULL, version = version + 1, updated_at = ?
           WHERE category_id IN (${placeholders})`
        ).run(now, ...ids)
      } else if (table === 'tags') {
        db.prepare(
          `UPDATE bookmarks SET version = version + 1, updated_at = ?
           WHERE id IN (
             SELECT DISTINCT bookmark_id FROM bookmark_tags WHERE tag_id IN (${placeholders})
           )`
        ).run(now, ...ids)
      }

      const remove = db.prepare(`DELETE FROM ${table} WHERE id = ? AND version = ?`)
      for (const item of items) {
        if (remove.run(item.id, item.version).changes !== 1) throw new VersionConflictError()
      }
    })()
    return true
  } catch (error) {
    if (error instanceof VersionConflictError) return false
    throw error
  }
}

class VersionConflictError extends Error {}

function reorderRows(
  db: ReturnType<typeof getDatabase>,
  table: 'categories' | 'tags',
  items: Array<{ id: string; version: number }>
): boolean {
  const statement = db.prepare(
    `UPDATE ${table} SET sort_order = ?, version = version + 1, updated_at = ?
     WHERE id = ? AND version = ?`
  )
  return db.transaction(() => {
    if (!versionsMatch(db, table, items)) return false
    const now = nowIso()
    for (const [order, item] of items.entries()) {
      if (statement.run(order, now, item.id, item.version).changes !== 1) return false
    }
    return true
  })()
}

function versionsMatch(
  db: ReturnType<typeof getDatabase>,
  table: 'bookmarks' | 'categories' | 'tags',
  items: Array<{ id: string; version: number }>
): boolean {
  const select = db.prepare(`SELECT version FROM ${table} WHERE id = ?`)
  return items.every(item => {
    const row = select.get(item.id) as { version: number } | undefined
    return row?.version === item.version
  })
}

function sendConflict(reply: FastifyReply, current: unknown) {
  return reply.code(409).send({
    success: false,
    code: 'VERSION_CONFLICT',
    message: 'The record changed on another device',
    data: current
  })
}

function sendConstraintError(reply: FastifyReply, error: unknown, message: string) {
  const code =
    typeof error === 'object' && error && 'code' in error ? String(error.code) : 'UNKNOWN'
  if (code.startsWith('SQLITE_CONSTRAINT')) {
    return reply.code(409).send({ success: false, code: 'DUPLICATE', message })
  }
  throw error
}

function notFound(entity: string) {
  return { success: false, code: 'NOT_FOUND', message: `${entity} not found` }
}

export default libraryRoutes
