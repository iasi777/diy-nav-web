import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AiClient } from '../lib/ai-gateway.js'

let app: FastifyInstance
let tempDir: string
let databasePath: string

const createAiClient = (
  classifyBookmarks: AiClient['classifyBookmarks'] = async (_model, taxonomy, bookmarks) =>
    bookmarks.map(item => ({
      itemId: item.itemId,
      category: taxonomy[0].name,
      tags: ['测试'],
      description: `分类：${item.title}`
    }))
): AiClient => ({
  isConfigured: () => true,
  listModels: async () => ['mock-model'],
  proposeTaxonomy: async () => [{ name: '测试' }],
  classifyBookmarks
})

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'diy-nav-imports-'))
  databasePath = join(tempDir, 'test.sqlite')
  process.env.NODE_ENV = 'test'
  process.env.DATABASE_PATH = databasePath
  const { buildApp } = await import('../../server.js')
  app = await buildApp({ aiClient: createAiClient() })
})

afterAll(async () => {
  await app.close()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('persistent AI import jobs', () => {
  it('passes existing vocabularies across AI chunks and canonicalizes exact variants', async () => {
    const propose = vi.fn<AiClient['proposeTaxonomy']>(
      async (_model, _bookmarks, existingCategories) => {
        expect(existingCategories).toEqual([
          expect.objectContaining({ name: '开发工具', usageCount: 1 })
        ])
        return [{ name: ' 开发工具 ', description: ' 开发相关网站 ' }]
      }
    )
    let call = 0
    const classify = vi.fn<AiClient['classifyBookmarks']>(
      async (_model, _taxonomy, bookmarks, tagVocabulary) => {
        call += 1
        expect(tagVocabulary).toContain('Git')
        if (call === 2) expect(tagVocabulary).toContain('新标签')
        return bookmarks.map(item => ({
          itemId: item.itemId,
          category: ' 开发工具 ',
          tags: [call === 1 ? ' 新标签 ' : ' git '],
          description: `分类：${item.title}`
        }))
      }
    )
    await app.close()
    const { buildApp } = await import('../../server.js')
    app = await buildApp({
      aiClient: {
        ...createAiClient(classify),
        proposeTaxonomy: propose
      }
    })

    const category = (
      await app.inject({
        method: 'POST',
        url: '/api/categories',
        payload: { name: '开发工具' }
      })
    ).json().data
    const tag = (
      await app.inject({
        method: 'POST',
        url: '/api/tags',
        payload: { name: 'Git', color: '#3B82F6' }
      })
    ).json().data
    await app.inject({
      method: 'POST',
      url: '/api/bookmarks',
      payload: {
        name: 'Existing',
        url: 'https://existing-vocabulary.example/',
        categoryId: category.id,
        tagIds: [tag.id]
      }
    })

    const imported = await uploadBookmarks(app, 21)
    const proposed = await app.inject({
      method: 'POST',
      url: `/api/imports/${imported.id}/taxonomy/propose`,
      payload: { model: 'mock-model' }
    })
    expect(proposed.statusCode).toBe(200)
    expect(proposed.json().data.taxonomy).toEqual([
      { name: '开发工具', description: '开发相关网站' }
    ])

    const started = await app.inject({
      method: 'POST',
      url: `/api/imports/${imported.id}/classify`,
      payload: { model: 'mock-model' }
    })
    expect(started.statusCode).toBe(202)
    const completed = await waitForImport(app, imported.id, batch => batch.status === 'review')

    expect(classify).toHaveBeenCalledTimes(2)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(completed.items.slice(0, 20).every((item: any) => item.tags[0] === '新标签')).toBe(true)
    expect(completed.items[20]).toMatchObject({
      categoryName: '开发工具',
      tags: ['Git']
    })
  })

  it('keeps successful chunks when another chunk fails', async () => {
    let call = 0
    const classify = vi.fn<AiClient['classifyBookmarks']>(async (_model, taxonomy, bookmarks) => {
      call += 1
      if (call === 1) throw new Error('temporary model failure')
      return bookmarks.map(item => ({
        itemId: item.itemId,
        category: taxonomy[0].name,
        tags: ['成功'],
        description: item.title
      }))
    })
    await app.close()
    const { buildApp } = await import('../../server.js')
    app = await buildApp({ aiClient: createAiClient(classify) })

    const imported = await uploadBookmarks(app, 21)
    const started = await app.inject({
      method: 'POST',
      url: `/api/imports/${imported.id}/classify`,
      payload: { model: 'mock-model' }
    })
    expect(started.statusCode).toBe(202)

    const completed = await waitForImport(app, imported.id, batch => batch.status === 'review')
    expect(classify).toHaveBeenCalledTimes(2)
    expect(completed.processedItems).toBe(21)
    expect(completed.counts).toMatchObject({ error: 20, ready: 1 })
    expect(completed.errorMessage).toContain('20 item(s) failed classification')
  })

  it('applies a stricter rate limit to AI endpoints', async () => {
    await app.close()
    const { buildApp } = await import('../../server.js')
    app = await buildApp({ aiClient: createAiClient() })

    const responses = []
    for (let requestNumber = 0; requestNumber < 11; requestNumber += 1) {
      responses.push(
        await app.inject({
          method: 'GET',
          url: '/api/ai/models',
          headers: { 'x-forwarded-for': '203.0.113.10' }
        })
      )
    }
    expect(responses.filter(response => response.statusCode === 200)).toHaveLength(10)
    expect(responses.filter(response => response.statusCode === 429)).toHaveLength(1)
  })

  it('resumes a queued job when the API starts again', async () => {
    const imported = await uploadBookmarks(app, 1)
    const { getDatabase } = await import('../lib/sqlite.js')
    getDatabase()
      .prepare(
        `UPDATE import_batches SET status = 'queued', selected_model = 'mock-model'
         WHERE id = ?`
      )
      .run(imported.id)

    await app.close()
    const { buildApp } = await import('../../server.js')
    app = await buildApp({ aiClient: createAiClient() })

    const completed = await waitForImport(app, imported.id, batch => batch.status === 'review')
    expect(completed.counts.ready).toBe(1)
    expect(completed.processedItems).toBe(1)
  })
})

async function uploadBookmarks(target: FastifyInstance, count: number) {
  const links = Array.from(
    { length: count },
    (_, index) => `<DT><A HREF="https://example.com/${index}">Example ${index}</A>`
  ).join('\n')
  const response = await target.inject({
    method: 'POST',
    url: '/api/imports',
    payload: { filename: 'bookmarks.html', content: `<DL><p>${links}</DL><p>` }
  })
  expect(response.statusCode).toBe(201)
  return response.json().data
}

async function waitForImport(
  target: FastifyInstance,
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  predicate: (batch: any) => boolean
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await target.inject({ method: 'GET', url: `/api/imports/${id}` })
    const batch = response.json().data
    if (predicate(batch)) return batch
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Import ${id} did not reach the expected state`)
}
