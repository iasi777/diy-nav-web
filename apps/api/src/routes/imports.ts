import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { z } from 'zod'
import { defaultAiClient, type AiClient, type Taxonomy } from '../lib/ai-gateway.js'
import { normalizeUrl, parseBookmarkFile } from '../lib/bookmark-import.js'
import {
  createId,
  getDatabase,
  listBookmarks,
  listCategories,
  listTags,
  nowIso
} from '../lib/sqlite.js'

const uploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  content: z
    .string()
    .min(1)
    .max(25 * 1024 * 1024)
})
const taxonomySchema = z.object({
  categories: z.array(
    z.object({
      name: z.string().trim().min(1).max(40),
      description: z.string().trim().max(120).optional()
    })
  )
})
const itemPatchSchema = z.object({
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(120).optional(),
  url: z.string().trim().min(1).max(2048).optional(),
  categoryName: z.string().trim().min(1).max(40).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(3).optional(),
  description: z.string().trim().max(500).optional(),
  excluded: z.boolean().optional()
})
const classifySchema = z.object({ model: z.string().trim().min(1).max(200) })
const commitSchema = z.object({ itemIds: z.array(z.string().uuid()).optional() })

interface ImportBatchRow {
  id: string
  filename: string
  format: string
  status: string
  taxonomy_json: string
  selected_model: string | null
  total_items: number
  processed_items: number
  error_message: string | null
  created_at: string
  updated_at: string
}

interface ImportItemRow {
  id: string
  batch_id: string
  source_index: number
  title: string
  url: string
  normalized_url: string | null
  folder_path: string
  status: string
  duplicate_bookmark_id: string | null
  category_name: string | null
  tags_json: string
  description: string | null
  error_message: string | null
  version: number
  created_at: string
  updated_at: string
}

const runningJobs = new Set<string>()

export interface ImportRouteOptions {
  aiClient?: AiClient
}

const importRoutes: FastifyPluginAsync<ImportRouteOptions> = async (app, options) => {
  const db = getDatabase()
  const aiClient = options.aiClient ?? defaultAiClient

  app.get(
    '/ai/models',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (_request, reply) => {
      if (!aiClient.isConfigured()) {
        return reply.code(503).send({
          success: false,
          code: 'AI_NOT_CONFIGURED',
          message: 'AI_NEW_API_BASE_URL and AI_NEW_API_KEY are required'
        })
      }
      return { success: true, data: await aiClient.listModels() }
    }
  )

  app.get('/imports', async () => {
    const rows = db
      .prepare('SELECT * FROM import_batches ORDER BY created_at DESC')
      .all() as ImportBatchRow[]
    return { success: true, data: rows.map(mapBatch) }
  })

  app.post('/imports', async (request, reply) => {
    const body = uploadSchema.parse(request.body)
    const parsed = parseBookmarkFile(body.filename, body.content)
    const batchId = createId()
    const now = nowIso()
    const existingUrls = new Map(
      (
        db.prepare('SELECT id, normalized_url FROM bookmarks').all() as Array<{
          id: string
          normalized_url: string
        }>
      ).map(row => [row.normalized_url, row.id])
    )
    const seen = new Set<string>()
    const folders = new Set<string>()

    db.transaction(() => {
      db.prepare(
        `INSERT INTO import_batches (
           id, filename, format, status, total_items, created_at, updated_at
         ) VALUES (?, ?, ?, 'preview', ?, ?, ?)`
      ).run(batchId, body.filename, parsed.format, parsed.bookmarks.length, now, now)

      const insert = db.prepare(
        `INSERT INTO import_items (
           id, batch_id, source_index, title, url, normalized_url, folder_path,
           status, duplicate_bookmark_id, category_name, tags_json, description,
           error_message, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      parsed.bookmarks.forEach((bookmark, index) => {
        let normalizedUrl: string | null = null
        let status = 'valid'
        let duplicateId: string | null = null
        let error: string | null = null
        try {
          normalizedUrl = normalizeUrl(bookmark.url)
          duplicateId = existingUrls.get(normalizedUrl) ?? null
          if (duplicateId) status = 'duplicate'
          else if (seen.has(normalizedUrl)) {
            status = 'duplicate'
            error = 'Duplicate URL in the uploaded file'
          } else {
            seen.add(normalizedUrl)
          }
        } catch (caught) {
          status = 'invalid'
          error = caught instanceof Error ? caught.message : 'Invalid URL'
        }
        if (bookmark.folderPath) folders.add(bookmark.folderPath.split(' / ')[0])
        insert.run(
          createId(),
          batchId,
          index,
          bookmark.title || bookmark.url,
          bookmark.url,
          normalizedUrl,
          bookmark.folderPath,
          status,
          duplicateId,
          bookmark.categoryName ?? firstFolder(bookmark.folderPath),
          JSON.stringify(bookmark.tagNames ?? []),
          bookmark.description ?? null,
          error,
          now,
          now
        )
      })

      const initialTaxonomy = [...folders]
        .filter(Boolean)
        .slice(0, 15)
        .map(name => ({ name }))
      if (initialTaxonomy.length === 0) initialTaxonomy.push({ name: '未分类' })
      db.prepare('UPDATE import_batches SET taxonomy_json = ? WHERE id = ?').run(
        JSON.stringify(initialTaxonomy),
        batchId
      )
    })()

    return reply.code(201).send({ success: true, data: getImport(batchId) })
  })

  app.get('/imports/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const batch = getImport(id)
    return batch ? { success: true, data: batch } : reply.code(404).send(notFound('Import batch'))
  })

  app.put('/imports/:id/taxonomy', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = taxonomySchema.parse(request.body)
    const result = db
      .prepare(
        `UPDATE import_batches SET taxonomy_json = ?, status = 'taxonomy',
         error_message = NULL, updated_at = ? WHERE id = ? AND status NOT IN ('committed', 'cancelled')`
      )
      .run(JSON.stringify(body.categories), nowIso(), id)
    if (result.changes === 0) return reply.code(409).send(invalidState())
    return { success: true, data: getImport(id) }
  })

  app.post(
    '/imports/:id/taxonomy/propose',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
      const { model } = classifySchema.parse(request.body)
      const batch = readBatch(id)
      if (!batch) return reply.code(404).send(notFound('Import batch'))
      const items = readItems(id)
        .filter(item => ['valid', 'ready', 'error'].includes(item.status))
        .map(item => ({ title: item.title, url: item.url, folderPath: item.folder_path }))
      const existingCategories = listCategories(db).map(category => ({
        name: category.name,
        description: category.description,
        usageCount: category.websiteCount
      }))
      const categories = canonicalizeTaxonomy(
        await aiClient.proposeTaxonomy(model, items, existingCategories),
        existingCategories
      )
      db.prepare(
        `UPDATE import_batches SET taxonomy_json = ?, selected_model = ?, status = 'taxonomy',
         error_message = NULL, updated_at = ? WHERE id = ?`
      ).run(JSON.stringify(categories), model, nowIso(), id)
      return { success: true, data: getImport(id) }
    }
  )

  app.post(
    '/imports/:id/classify',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
      const { model } = classifySchema.parse(request.body)
      const batch = readBatch(id)
      if (!batch) return reply.code(404).send(notFound('Import batch'))
      const taxonomy = taxonomySchema.parse({
        categories: JSON.parse(batch.taxonomy_json)
      }).categories
      if (taxonomy.length === 0) {
        return reply.code(400).send({
          success: false,
          code: 'EMPTY_TAXONOMY',
          message: 'Confirm at least one category before classification'
        })
      }
      const result = db
        .prepare(
          `UPDATE import_batches SET selected_model = ?, status = 'queued',
           processed_items = (
             SELECT COUNT(*) FROM import_items
             WHERE batch_id = ? AND status NOT IN ('valid', 'error')
           ), error_message = NULL, updated_at = ?
           WHERE id = ? AND status NOT IN ('committed', 'cancelled')`
        )
        .run(model, id, nowIso(), id)
      if (result.changes === 0) return reply.code(409).send(invalidState())
      queueClassification(id, aiClient)
      return reply.code(202).send({ success: true, data: getImport(id) })
    }
  )

  app.patch('/imports/:id/items/:itemId', async (request, reply) => {
    const { id, itemId } = z
      .object({ id: z.string().uuid(), itemId: z.string().uuid() })
      .parse(request.params)
    const body = itemPatchSchema.parse(request.body)
    const item = db
      .prepare('SELECT * FROM import_items WHERE id = ? AND batch_id = ?')
      .get(itemId, id) as ImportItemRow | undefined
    if (!item) return reply.code(404).send(notFound('Import item'))
    const batch = readBatch(id)
    if (!batch || batch.status === 'committed' || batch.status === 'cancelled') {
      return reply.code(409).send(invalidState())
    }
    if (item.version !== body.version) return sendConflict(reply, mapItem(item))

    const url = body.url ?? item.url
    let normalizedUrl = item.normalized_url
    let status =
      body.excluded === true ? 'excluded' : body.excluded === false ? 'ready' : item.status
    let duplicateBookmarkId: string | null = null
    let error: string | null = null
    try {
      normalizedUrl = normalizeUrl(url)
      const existing = db
        .prepare('SELECT id FROM bookmarks WHERE normalized_url = ?')
        .get(normalizedUrl) as { id: string } | undefined
      const duplicateImport = db
        .prepare(
          `SELECT id FROM import_items
           WHERE batch_id = ? AND id != ? AND normalized_url = ?
           AND status NOT IN ('invalid', 'excluded')
           LIMIT 1`
        )
        .get(id, itemId, normalizedUrl) as { id: string } | undefined
      duplicateBookmarkId = existing?.id ?? null
      if (!body.excluded && (existing || duplicateImport)) {
        status = 'duplicate'
        error = existing
          ? 'URL already exists in the bookmark library'
          : 'Duplicate URL in this import batch'
      } else if (
        !body.excluded &&
        (body.categoryName !== undefined ||
          body.tags !== undefined ||
          body.description !== undefined ||
          body.title !== undefined ||
          body.url !== undefined)
      ) {
        status = 'ready'
      }
      if (!body.excluded && ['invalid', 'error'].includes(status)) status = 'ready'
    } catch (caught) {
      normalizedUrl = null
      status = 'invalid'
      error = caught instanceof Error ? caught.message : 'Invalid URL'
    }
    const result = db
      .prepare(
        `UPDATE import_items SET title = ?, url = ?, normalized_url = ?, status = ?,
         duplicate_bookmark_id = ?, category_name = ?, tags_json = ?, description = ?,
         error_message = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND batch_id = ? AND version = ?`
      )
      .run(
        body.title ?? item.title,
        url,
        normalizedUrl,
        status,
        duplicateBookmarkId,
        body.categoryName ?? item.category_name,
        JSON.stringify(body.tags ?? JSON.parse(item.tags_json)),
        body.description ?? item.description,
        error,
        nowIso(),
        itemId,
        id,
        body.version
      )
    if (result.changes === 0) return sendConflict(reply, getImport(id))
    return { success: true, data: getImport(id) }
  })

  app.post('/imports/:id/commit', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = commitSchema.parse(request.body ?? {})
    const batch = readBatch(id)
    if (!batch) return reply.code(404).send(notFound('Import batch'))
    if (batch.status === 'committed' || batch.status === 'cancelled') {
      return reply.code(409).send(invalidState())
    }
    const allowedIds = body.itemIds ? new Set(body.itemIds) : undefined
    const items = readItems(id).filter(
      item => item.status === 'ready' && (!allowedIds || allowedIds.has(item.id))
    )
    if (items.length === 0) {
      return reply.code(400).send({
        success: false,
        code: 'NO_ITEMS',
        message: 'No reviewed items are selected for commit'
      })
    }

    try {
      db.transaction(() => {
        const now = nowIso()
        let bookmarkOrder = (
          db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM bookmarks').get() as {
            value: number
          }
        ).value
        for (const item of items) {
          if (!item.normalized_url) throw new Error(`Item ${item.id} has no valid URL`)
          const categoryId = ensureCategory(item.category_name || '未分类')
          const tagIds = (JSON.parse(item.tags_json) as string[]).map(ensureTag)
          const bookmarkId = createId()
          db.prepare(
            `INSERT INTO bookmarks (
               id, name, url, normalized_url, description, category_id, sort_order,
               source_import_item_id, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            bookmarkId,
            item.title,
            item.url,
            item.normalized_url,
            item.description,
            categoryId,
            bookmarkOrder,
            item.id,
            now,
            now
          )
          const insertTag = db.prepare(
            'INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)'
          )
          for (const tagId of tagIds) insertTag.run(bookmarkId, tagId)
          bookmarkOrder += 1
        }
        db.prepare(
          `UPDATE import_batches SET status = 'committed', processed_items = ?,
           updated_at = ? WHERE id = ?`
        ).run(items.length, now, id)
      })()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Import commit failed'
      return reply.code(409).send({ success: false, code: 'COMMIT_FAILED', message })
    }
    return {
      success: true,
      data: {
        import: getImport(id),
        bookmarks: listBookmarks(db),
        categories: listCategories(db),
        tags: listTags(db)
      }
    }
  })

  app.post('/imports/:id/cancel', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const result = db
      .prepare(
        `UPDATE import_batches SET status = 'cancelled', updated_at = ?
         WHERE id = ? AND status != 'committed'`
      )
      .run(nowIso(), id)
    if (result.changes === 0) return reply.code(409).send(invalidState())
    return { success: true, data: getImport(id) }
  })

  resumeClassificationJobs(aiClient)

  function ensureCategory(name: string): string {
    const existing = db
      .prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE')
      .get(name) as { id: string } | undefined
    if (existing) return existing.id
    const id = createId()
    const now = nowIso()
    const order = (
      db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM categories').get() as {
        value: number
      }
    ).value
    db.prepare(
      'INSERT INTO categories (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, name, order, now, now)
    return id
  }

  function ensureTag(name: string): string {
    const existing = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(name) as
      | { id: string }
      | undefined
    if (existing) return existing.id
    const id = createId()
    const now = nowIso()
    const count = (db.prepare('SELECT COUNT(*) AS value FROM tags').get() as { value: number })
      .value
    db.prepare(
      'INSERT INTO tags (id, name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, name, tagColor(count), count, now, now)
    return id
  }
}

function queueClassification(batchId: string, aiClient: AiClient): void {
  if (runningJobs.has(batchId)) return
  runningJobs.add(batchId)
  setImmediate(() => {
    runClassification(batchId, aiClient)
      .catch(() => undefined)
      .finally(() => runningJobs.delete(batchId))
  })
}

async function runClassification(batchId: string, aiClient: AiClient): Promise<void> {
  const db = getDatabase()
  const batch = readBatch(batchId)
  if (!batch?.selected_model || batch.status === 'cancelled') return
  const taxonomy = taxonomySchema.parse({ categories: JSON.parse(batch.taxonomy_json) })
    .categories as Taxonomy
  db.prepare(
    `UPDATE import_batches SET status = 'classifying', error_message = NULL, updated_at = ?
     WHERE id = ? AND status != 'cancelled'`
  ).run(nowIso(), batchId)

  try {
    const allItems = readItems(batchId)
    const pending = allItems.filter(item => ['valid', 'error'].includes(item.status))
    const sharedTags = new Map(
      listTags(db).map(tag => [normalizeVocabularyKey(tag.name), tag.name] as const)
    )
    for (const item of allItems.filter(item => item.status === 'ready')) {
      for (const tag of JSON.parse(item.tags_json) as string[]) {
        const trimmed = tag.trim()
        if (trimmed) {
          const key = normalizeVocabularyKey(trimmed)
          sharedTags.set(key, sharedTags.get(key) ?? trimmed)
        }
      }
    }
    let processed = allItems.filter(item => !['valid', 'error'].includes(item.status)).length
    let failed = 0
    const failureMessages = new Set<string>()
    for (let offset = 0; offset < pending.length; offset += 20) {
      if (readBatch(batchId)?.status === 'cancelled') return
      const chunk = pending.slice(offset, offset + 20)
      let results: Awaited<ReturnType<AiClient['classifyBookmarks']>>
      try {
        results = await aiClient.classifyBookmarks(
          batch.selected_model,
          taxonomy,
          chunk.map(item => ({
            itemId: item.id,
            title: item.title,
            url: item.url,
            folderPath: item.folder_path
          })),
          [...sharedTags.values()]
        )
        results = canonicalizeClassification(results, taxonomy, sharedTags)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Classification failed'
        const markError = db.prepare(
          `UPDATE import_items SET status = 'error', error_message = ?,
           version = version + 1, updated_at = ?
           WHERE id = ? AND batch_id = ? AND status != 'excluded'`
        )
        db.transaction(() => {
          for (const item of chunk) markError.run(message, nowIso(), item.id, batchId)
          failed += chunk.length
          processed += chunk.length
          failureMessages.add(message)
          updateBatchProgress(db, batchId, processed)
        })()
        continue
      }
      if (readBatch(batchId)?.status === 'cancelled') return
      db.transaction(() => {
        const update = db.prepare(
          `UPDATE import_items SET category_name = ?, tags_json = ?, description = ?,
           status = 'ready', error_message = NULL, version = version + 1, updated_at = ?
           WHERE id = ? AND batch_id = ?`
        )
        for (const result of results) {
          update.run(
            result.category,
            JSON.stringify(result.tags),
            result.description,
            nowIso(),
            result.itemId,
            batchId
          )
        }
        for (const result of results) {
          for (const tag of result.tags) sharedTags.set(normalizeVocabularyKey(tag), tag)
        }
        processed += chunk.length
        updateBatchProgress(db, batchId, processed)
      })()
    }
    db.prepare(
      `UPDATE import_batches SET status = 'review', processed_items = ?,
       error_message = ?, updated_at = ? WHERE id = ? AND status != 'cancelled'`
    ).run(
      processed,
      failed > 0
        ? `${failed} item(s) failed classification: ${[...failureMessages].join('; ').slice(0, 500)}`
        : null,
      nowIso(),
      batchId
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Classification failed'
    db.prepare(
      `UPDATE import_batches SET status = 'failed', error_message = ?, updated_at = ?
       WHERE id = ? AND status != 'cancelled'`
    ).run(message, nowIso(), batchId)
  }
}

function resumeClassificationJobs(aiClient: AiClient): void {
  const rows = getDatabase()
    .prepare("SELECT id FROM import_batches WHERE status IN ('queued', 'classifying')")
    .all() as Array<{ id: string }>
  for (const row of rows) queueClassification(row.id, aiClient)
}

function updateBatchProgress(
  db: ReturnType<typeof getDatabase>,
  batchId: string,
  processed: number
): void {
  db.prepare(
    `UPDATE import_batches SET processed_items = ?, updated_at = ?
     WHERE id = ? AND status != 'cancelled'`
  ).run(processed, nowIso(), batchId)
}

function readBatch(id: string): ImportBatchRow | undefined {
  return getDatabase().prepare('SELECT * FROM import_batches WHERE id = ?').get(id) as
    | ImportBatchRow
    | undefined
}

function readItems(batchId: string): ImportItemRow[] {
  return getDatabase()
    .prepare('SELECT * FROM import_items WHERE batch_id = ? ORDER BY source_index')
    .all(batchId) as ImportItemRow[]
}

function getImport(id: string) {
  const batch = readBatch(id)
  if (!batch) return undefined
  const items = readItems(id)
  const counts = items.reduce<Record<string, number>>((result, item) => {
    result[item.status] = (result[item.status] ?? 0) + 1
    return result
  }, {})
  return { ...mapBatch(batch), counts, items: items.map(mapItem) }
}

function mapBatch(row: ImportBatchRow) {
  return {
    id: row.id,
    filename: row.filename,
    format: row.format,
    status: row.status,
    taxonomy: JSON.parse(row.taxonomy_json),
    selectedModel: row.selected_model ?? undefined,
    totalItems: row.total_items,
    processedItems: row.processed_items,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapItem(row: ImportItemRow) {
  return {
    id: row.id,
    sourceIndex: row.source_index,
    title: row.title,
    url: row.url,
    normalizedUrl: row.normalized_url ?? undefined,
    folderPath: row.folder_path,
    status: row.status,
    duplicateBookmarkId: row.duplicate_bookmark_id ?? undefined,
    categoryName: row.category_name ?? undefined,
    tags: JSON.parse(row.tags_json),
    description: row.description ?? undefined,
    errorMessage: row.error_message ?? undefined,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function firstFolder(path: string): string | null {
  return path ? path.split(' / ')[0] : null
}

function tagColor(index: number): string {
  const colors = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#6B7280']
  return colors[index % colors.length]
}

function canonicalizeTaxonomy(
  taxonomy: Taxonomy,
  existingCategories: Array<{ name: string }>
): Taxonomy {
  const existing = new Map(
    existingCategories.map(category => [normalizeVocabularyKey(category.name), category.name])
  )
  const seen = new Set<string>()
  const result: Taxonomy = []
  for (const category of taxonomy) {
    const trimmedName = category.name.trim()
    const name = existing.get(normalizeVocabularyKey(trimmedName)) ?? trimmedName
    const key = normalizeVocabularyKey(name)
    if (!name || seen.has(key)) continue
    seen.add(key)
    result.push({
      name,
      ...(category.description?.trim() ? { description: category.description.trim() } : {})
    })
  }
  return result
}

function canonicalizeClassification(
  results: Awaited<ReturnType<AiClient['classifyBookmarks']>>,
  taxonomy: Taxonomy,
  sharedTags: Map<string, string>
): Awaited<ReturnType<AiClient['classifyBookmarks']>> {
  const categories = new Map(
    taxonomy.map(category => [normalizeVocabularyKey(category.name), category.name])
  )
  return results.map(result => ({
    ...result,
    category: categories.get(normalizeVocabularyKey(result.category)) ?? result.category.trim(),
    tags: result.tags.map(tag => {
      const trimmed = tag.trim()
      return sharedTags.get(normalizeVocabularyKey(trimmed)) ?? trimmed
    }),
    description: result.description.trim()
  }))
}

function normalizeVocabularyKey(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function sendConflict(reply: FastifyReply, current: unknown) {
  return reply.code(409).send({
    success: false,
    code: 'VERSION_CONFLICT',
    message: 'The import item changed on another device',
    data: current
  })
}

function notFound(entity: string) {
  return { success: false, code: 'NOT_FOUND', message: `${entity} not found` }
}

function invalidState() {
  return {
    success: false,
    code: 'INVALID_IMPORT_STATE',
    message: 'The import batch cannot be changed in its current state'
  }
}

export default importRoutes
