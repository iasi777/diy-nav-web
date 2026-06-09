import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { z } from 'zod'
import { getDatabase, listBookmarks, listCategories, listTags, nowIso } from '../lib/sqlite.js'

const systemRoutes: FastifyPluginAsync = async app => {
  const db = getDatabase()

  app.get('/export/json', async (_request, reply) => {
    const payload = {
      meta: {
        version: '2.0.0',
        createdAt: nowIso(),
        appVersion: '1.0.0',
        platform: 'sqlite'
      },
      data: {
        websites: listBookmarks(db),
        categories: listCategories(db),
        tags: listTags(db)
      }
    }
    reply.header('Content-Disposition', `attachment; filename="diy-nav-${Date.now()}.json"`)
    return { success: true, data: payload }
  })

  app.get('/settings', async () => {
    const rows = db
      .prepare('SELECT key, value_json, version, updated_at FROM settings ORDER BY key')
      .all() as Array<{ key: string; value_json: string; version: number; updated_at: string }>
    return {
      success: true,
      data: rows.map(row => ({
        key: row.key,
        value: JSON.parse(row.value_json),
        version: row.version,
        updatedAt: row.updated_at
      }))
    }
  })

  app.get('/metrics', async () => {
    const scalar = (sql: string): number => (db.prepare(sql).get() as { value: number }).value
    const pageCount = db.pragma('page_count', { simple: true }) as number
    const pageSize = db.pragma('page_size', { simple: true }) as number
    return {
      success: true,
      data: {
        timestamp: nowIso(),
        uptimeSeconds: Math.floor(process.uptime()),
        bookmarks: scalar('SELECT COUNT(*) AS value FROM bookmarks'),
        categories: scalar('SELECT COUNT(*) AS value FROM categories'),
        tags: scalar('SELECT COUNT(*) AS value FROM tags'),
        imports: {
          total: scalar('SELECT COUNT(*) AS value FROM import_batches'),
          queued: scalar("SELECT COUNT(*) AS value FROM import_batches WHERE status = 'queued'"),
          classifying: scalar(
            "SELECT COUNT(*) AS value FROM import_batches WHERE status = 'classifying'"
          ),
          review: scalar("SELECT COUNT(*) AS value FROM import_batches WHERE status = 'review'"),
          failed: scalar("SELECT COUNT(*) AS value FROM import_batches WHERE status = 'failed'")
        },
        database: {
          sizeBytes: pageCount * pageSize,
          journalMode: db.pragma('journal_mode', { simple: true }),
          foreignKeys: db.pragma('foreign_keys', { simple: true })
        }
      }
    }
  })

  app.put('/settings/:key', async (request, reply) => {
    const { key } = z.object({ key: z.string().trim().min(1).max(100) }).parse(request.params)
    const body = z
      .object({ value: z.unknown(), version: z.number().int().positive().optional() })
      .parse(request.body)
    const current = db.prepare('SELECT version FROM settings WHERE key = ?').get(key) as
      | { version: number }
      | undefined
    if (current && body.version !== current.version) {
      return conflict(reply, current.version)
    }
    if (!current && body.version !== undefined) return conflict(reply, undefined)
    const now = nowIso()
    db.prepare(
      `INSERT INTO settings (key, value_json, version, updated_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
       version = settings.version + 1, updated_at = excluded.updated_at`
    ).run(key, JSON.stringify(body.value), now)
    const saved = db
      .prepare('SELECT key, value_json, version, updated_at FROM settings WHERE key = ?')
      .get(key) as { key: string; value_json: string; version: number; updated_at: string }
    return {
      success: true,
      data: {
        key: saved.key,
        value: JSON.parse(saved.value_json),
        version: saved.version,
        updatedAt: saved.updated_at
      }
    }
  })

  app.post('/library/clear', async (request, reply) => {
    const { confirmation } = z
      .object({ confirmation: z.literal('DELETE ALL BOOKMARKS') })
      .parse(request.body)
    void confirmation
    db.transaction(() => {
      db.prepare('DELETE FROM import_batches').run()
      db.prepare('DELETE FROM bookmarks').run()
      db.prepare('DELETE FROM categories').run()
      db.prepare('DELETE FROM tags').run()
      db.prepare('DELETE FROM settings').run()
    })()
    return reply.send({ success: true })
  })
}

function conflict(reply: FastifyReply, version: number | undefined) {
  return reply.code(409).send({
    success: false,
    code: 'VERSION_CONFLICT',
    message: 'The setting changed on another device',
    data: { version }
  })
}

export default systemRoutes
