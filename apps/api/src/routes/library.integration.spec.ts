import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let app: FastifyInstance
let tempDir: string

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'diy-nav-api-'))
  process.env.NODE_ENV = 'test'
  process.env.DATABASE_PATH = join(tempDir, 'test.sqlite')
  const { buildApp } = await import('../../server.js')
  app = await buildApp()
})

afterAll(async () => {
  await app.close()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('central library API', () => {
  it('supports CRUD and rejects stale versions', async () => {
    const categoryResponse = await app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: '开发', icon: 'fas fa-code' }
    })
    expect(categoryResponse.statusCode).toBe(201)
    const category = categoryResponse.json().data

    const tagResponse = await app.inject({
      method: 'POST',
      url: '/api/tags',
      payload: { name: 'Git', color: '#3B82F6' }
    })
    const tag = tagResponse.json().data

    const bookmarkResponse = await app.inject({
      method: 'POST',
      url: '/api/bookmarks',
      payload: {
        name: 'GitHub',
        url: 'https://github.com/',
        categoryId: category.id,
        tagIds: [tag.id]
      }
    })
    expect(bookmarkResponse.statusCode).toBe(201)
    const bookmark = bookmarkResponse.json().data
    expect(bookmark.version).toBe(1)

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/bookmarks/${bookmark.id}`,
      payload: { version: 1, description: '代码托管' }
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().data.version).toBe(2)

    const stale = await app.inject({
      method: 'PATCH',
      url: `/api/bookmarks/${bookmark.id}`,
      payload: { version: 1, description: '旧设备覆盖' }
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().code).toBe('VERSION_CONFLICT')
  })

  it('allows only one of two concurrent updates with the same version', async () => {
    const createdResponse = await app.inject({
      method: 'POST',
      url: '/api/bookmarks',
      payload: { name: 'Concurrent', url: 'https://concurrent.example/' }
    })
    const created = createdResponse.json().data

    const responses = await Promise.all([
      app.inject({
        method: 'PATCH',
        url: `/api/bookmarks/${created.id}`,
        payload: { version: created.version, name: 'Device A' }
      }),
      app.inject({
        method: 'PATCH',
        url: `/api/bookmarks/${created.id}`,
        payload: { version: created.version, name: 'Device B' }
      })
    ])

    expect(responses.map(response => response.statusCode).sort()).toEqual([200, 409])
  })

  it('bulk deletes transactionally and updates affected bookmark versions once', async () => {
    const categoryA = (
      await app.inject({
        method: 'POST',
        url: '/api/categories',
        payload: { name: '批量分类 A' }
      })
    ).json().data
    const categoryB = (
      await app.inject({
        method: 'POST',
        url: '/api/categories',
        payload: { name: '批量分类 B' }
      })
    ).json().data
    const tagA = (
      await app.inject({
        method: 'POST',
        url: '/api/tags',
        payload: { name: '批量标签 A', color: '#3B82F6' }
      })
    ).json().data
    const tagB = (
      await app.inject({
        method: 'POST',
        url: '/api/tags',
        payload: { name: '批量标签 B', color: '#10B981' }
      })
    ).json().data
    const sharedBookmark = (
      await app.inject({
        method: 'POST',
        url: '/api/bookmarks',
        payload: {
          name: '共享标签',
          url: 'https://bulk-shared.example/',
          categoryId: categoryA.id,
          tagIds: [tagA.id, tagB.id]
        }
      })
    ).json().data
    const categoryBookmark = (
      await app.inject({
        method: 'POST',
        url: '/api/bookmarks',
        payload: {
          name: '分类删除',
          url: 'https://bulk-category.example/',
          categoryId: categoryB.id
        }
      })
    ).json().data
    const deletedBookmark = (
      await app.inject({
        method: 'POST',
        url: '/api/bookmarks',
        payload: { name: '书签删除', url: 'https://bulk-bookmark.example/' }
      })
    ).json().data

    const empty = await app.inject({
      method: 'POST',
      url: '/api/bookmarks/bulk-delete',
      payload: { items: [] }
    })
    expect(empty.statusCode).toBe(400)

    const conflict = await app.inject({
      method: 'POST',
      url: '/api/tags/bulk-delete',
      payload: {
        items: [
          { id: tagA.id, version: tagA.version + 1 },
          { id: tagB.id, version: tagB.version }
        ]
      }
    })
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json().code).toBe('VERSION_CONFLICT')
    const afterConflict = (await app.inject({ method: 'GET', url: '/api/bookmarks' })).json().data
    expect(
      afterConflict.find((item: { id: string }) => item.id === sharedBookmark.id)
    ).toMatchObject({
      version: sharedBookmark.version,
      tagIds: expect.arrayContaining([tagA.id, tagB.id])
    })

    const missing = await app.inject({
      method: 'POST',
      url: '/api/bookmarks/bulk-delete',
      payload: { items: [{ id: randomUUID(), version: 1 }] }
    })
    expect(missing.statusCode).toBe(409)
    expect(missing.json().code).toBe('VERSION_CONFLICT')

    const deletedTags = await app.inject({
      method: 'POST',
      url: '/api/tags/bulk-delete',
      payload: {
        items: [
          { id: tagA.id, version: tagA.version },
          { id: tagB.id, version: tagB.version }
        ]
      }
    })
    expect(deletedTags.statusCode).toBe(200)
    const afterTags = (await app.inject({ method: 'GET', url: '/api/bookmarks' })).json().data
    expect(afterTags.find((item: { id: string }) => item.id === sharedBookmark.id)).toMatchObject({
      version: sharedBookmark.version + 1,
      tagIds: []
    })

    const deletedCategories = await app.inject({
      method: 'POST',
      url: '/api/categories/bulk-delete',
      payload: {
        items: [
          { id: categoryA.id, version: categoryA.version },
          { id: categoryB.id, version: categoryB.version }
        ]
      }
    })
    expect(deletedCategories.statusCode).toBe(200)
    const afterCategories = (await app.inject({ method: 'GET', url: '/api/bookmarks' })).json().data
    expect(
      afterCategories.find((item: { id: string }) => item.id === sharedBookmark.id)
    ).toMatchObject({
      categoryId: '',
      version: sharedBookmark.version + 2
    })
    expect(
      afterCategories.find((item: { id: string }) => item.id === categoryBookmark.id)
    ).toMatchObject({
      categoryId: '',
      version: categoryBookmark.version + 1
    })

    const deletedBookmarks = await app.inject({
      method: 'POST',
      url: '/api/bookmarks/bulk-delete',
      payload: {
        items: [
          { id: sharedBookmark.id, version: sharedBookmark.version + 2 },
          { id: deletedBookmark.id, version: deletedBookmark.version }
        ]
      }
    })
    expect(deletedBookmarks.statusCode).toBe(200)
    const remaining = (await app.inject({ method: 'GET', url: '/api/bookmarks' })).json().data
    expect(remaining.some((item: { id: string }) => item.id === sharedBookmark.id)).toBe(false)
    expect(remaining.some((item: { id: string }) => item.id === deletedBookmark.id)).toBe(false)
  })

  it('previews duplicate and invalid links, then commits reviewed items', async () => {
    const upload = await app.inject({
      method: 'POST',
      url: '/api/imports',
      payload: {
        filename: 'bookmarks.html',
        content: `<DL><p>
          <DT><A HREF="https://github.com">Existing</A>
          <DT><A HREF="https://example.org/path/">Example</A>
          <DT><A HREF="javascript:alert(1)">Invalid</A>
        </DL><p>`
      }
    })
    expect(upload.statusCode).toBe(201)
    const imported = upload.json().data
    expect(imported.counts).toMatchObject({ duplicate: 1, valid: 1, invalid: 1 })
    const valid = imported.items.find((item: { status: string }) => item.status === 'valid')

    const markedReviewed = await app.inject({
      method: 'PATCH',
      url: `/api/imports/${imported.id}/items/${valid.id}`,
      payload: {
        version: valid.version,
        excluded: false
      }
    })
    expect(markedReviewed.statusCode).toBe(200)
    const readyItem = markedReviewed
      .json()
      .data.items.find((item: { id: string }) => item.id === valid.id)
    expect(readyItem.status).toBe('ready')

    const duplicateAfterEdit = await app.inject({
      method: 'PATCH',
      url: `/api/imports/${imported.id}/items/${valid.id}`,
      payload: {
        version: readyItem.version,
        url: 'https://github.com/'
      }
    })
    expect(duplicateAfterEdit.statusCode).toBe(200)
    const duplicateItem = duplicateAfterEdit
      .json()
      .data.items.find((item: { id: string }) => item.id === valid.id)
    expect(duplicateItem.status).toBe('duplicate')
    expect(duplicateItem.duplicateBookmarkId).toBeTruthy()

    const reviewed = await app.inject({
      method: 'PATCH',
      url: `/api/imports/${imported.id}/items/${valid.id}`,
      payload: {
        version: duplicateItem.version,
        url: 'https://example.org/path/',
        categoryName: '参考',
        tags: ['文档'],
        description: '示例站点'
      }
    })
    expect(reviewed.statusCode).toBe(200)

    const committed = await app.inject({
      method: 'POST',
      url: `/api/imports/${imported.id}/commit`,
      payload: {}
    })
    expect(committed.statusCode).toBe(200)
    expect(committed.json().data.import.status).toBe('committed')

    const editAfterCommit = await app.inject({
      method: 'PATCH',
      url: `/api/imports/${imported.id}/items/${valid.id}`,
      payload: {
        version: reviewed.json().data.items.find((item: { id: string }) => item.id === valid.id)
          .version,
        title: 'Should not change'
      }
    })
    expect(editAfterCommit.statusCode).toBe(409)
    expect(editAfterCommit.json().code).toBe('INVALID_IMPORT_STATE')

    const exported = await app.inject({ method: 'GET', url: '/api/export/json' })
    expect(exported.json().data.data.websites).toHaveLength(4)

    const metrics = await app.inject({ method: 'GET', url: '/api/metrics' })
    expect(metrics.statusCode).toBe(200)
    expect(metrics.json().data).toMatchObject({
      bookmarks: 4,
      database: { journalMode: 'wal', foreignKeys: 1 }
    })
  })
})
