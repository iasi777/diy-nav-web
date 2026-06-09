import type { Category, Tag, Website } from '@/types'
import { request, type ApiResponse } from '@/utils/http'

type WireWebsite = Omit<Website, 'createdAt' | 'updatedAt' | 'lastVisited'> & {
  createdAt: string
  updatedAt: string
  lastVisited?: string
}
type WireCategory = Omit<Category, 'createdAt' | 'updatedAt'> & {
  createdAt: string
  updatedAt: string
}
type WireTag = Omit<Tag, 'createdAt' | 'updatedAt'> & {
  createdAt: string
  updatedAt: string
}
type VersionedItem = { id: string; version: number }

export const libraryApi = {
  async listBookmarks(): Promise<Website[]> {
    return unwrap(await request.get<WireWebsite[]>('/api/bookmarks')).map(hydrateWebsite)
  },
  async createBookmark(
    input: Pick<
      Website,
      | 'name'
      | 'url'
      | 'description'
      | 'categoryId'
      | 'tagIds'
      | 'favicon'
      | 'isFavorite'
      | 'isOnline'
    >
  ): Promise<Website> {
    return hydrateWebsite(unwrap(await request.post<WireWebsite>('/api/bookmarks', input)))
  },
  async updateBookmark(id: string, version: number, updates: Partial<Website>): Promise<Website> {
    return hydrateWebsite(
      unwrap(await request.patch<WireWebsite>(`/api/bookmarks/${id}`, { ...updates, version }))
    )
  },
  async deleteBookmark(id: string, version: number): Promise<void> {
    unwrap(await request.delete(`/api/bookmarks/${id}`, { params: { version: String(version) } }))
  },
  async bulkDeleteBookmarks(items: VersionedItem[]): Promise<void> {
    unwrap(await request.post('/api/bookmarks/bulk-delete', { items }))
  },
  async visitBookmark(id: string, version: number): Promise<Website> {
    return hydrateWebsite(
      unwrap(await request.post<WireWebsite>(`/api/bookmarks/${id}/visit`, { version }))
    )
  },
  async reorderBookmarks(items: Website[], favorite = false): Promise<Website[]> {
    return unwrap(
      await request.post<WireWebsite[]>('/api/bookmarks/reorder', {
        favorite,
        items: items.map(item => ({ id: item.id, version: item.version }))
      })
    ).map(hydrateWebsite)
  },
  async listCategories(): Promise<Category[]> {
    return unwrap(await request.get<WireCategory[]>('/api/categories')).map(hydrateCategory)
  },
  async createCategory(input: Pick<Category, 'name' | 'description' | 'icon'>): Promise<Category> {
    return hydrateCategory(unwrap(await request.post<WireCategory>('/api/categories', input)))
  },
  async updateCategory(id: string, version: number, updates: Partial<Category>): Promise<Category> {
    return hydrateCategory(
      unwrap(await request.patch<WireCategory>(`/api/categories/${id}`, { ...updates, version }))
    )
  },
  async deleteCategory(id: string, version: number): Promise<void> {
    unwrap(await request.delete(`/api/categories/${id}`, { params: { version: String(version) } }))
  },
  async bulkDeleteCategories(items: VersionedItem[]): Promise<void> {
    unwrap(await request.post('/api/categories/bulk-delete', { items }))
  },
  async reorderCategories(items: Category[]): Promise<Category[]> {
    return unwrap(
      await request.post<WireCategory[]>('/api/categories/reorder', {
        items: items.map(item => ({ id: item.id, version: item.version }))
      })
    ).map(hydrateCategory)
  },
  async listTags(): Promise<Tag[]> {
    return unwrap(await request.get<WireTag[]>('/api/tags')).map(hydrateTag)
  },
  async createTag(input: Pick<Tag, 'name' | 'color'>): Promise<Tag> {
    return hydrateTag(unwrap(await request.post<WireTag>('/api/tags', input)))
  },
  async updateTag(id: string, version: number, updates: Partial<Tag>): Promise<Tag> {
    return hydrateTag(
      unwrap(await request.patch<WireTag>(`/api/tags/${id}`, { ...updates, version }))
    )
  },
  async deleteTag(id: string, version: number): Promise<void> {
    unwrap(await request.delete(`/api/tags/${id}`, { params: { version: String(version) } }))
  },
  async bulkDeleteTags(items: VersionedItem[]): Promise<void> {
    unwrap(await request.post('/api/tags/bulk-delete', { items }))
  },
  async reorderTags(items: Tag[]): Promise<Tag[]> {
    return unwrap(
      await request.post<WireTag[]>('/api/tags/reorder', {
        items: items.map(item => ({ id: item.id, version: item.version }))
      })
    ).map(hydrateTag)
  },
  async clear(): Promise<void> {
    unwrap(
      await request.post('/api/library/clear', { confirmation: 'DELETE ALL BOOKMARKS' as const })
    )
  },
  async exportJson() {
    return unwrap(await request.get('/api/export/json'))
  }
}

export function unwrap<T>(response: ApiResponse<T>): T {
  if (!response.success) {
    const error = new Error(response.message || 'API request failed')
    Object.assign(error, { code: response.code, data: response.data })
    throw error
  }
  return response.data as T
}

function hydrateWebsite(item: WireWebsite): Website {
  return {
    ...item,
    createdAt: new Date(item.createdAt),
    updatedAt: new Date(item.updatedAt),
    lastVisited: item.lastVisited ? new Date(item.lastVisited) : undefined
  }
}

function hydrateCategory(item: WireCategory): Category {
  return { ...item, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) }
}

function hydrateTag(item: WireTag): Tag {
  return { ...item, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) }
}
