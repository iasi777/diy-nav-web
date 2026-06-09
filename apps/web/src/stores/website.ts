import { computed, readonly, ref } from 'vue'
import { defineStore } from 'pinia'
import type { SearchFilters, SortField, SortOrder, Website } from '@/types'
import { libraryApi } from '@/api/library'

export const useWebsiteStore = defineStore('website', () => {
  const websites = ref<Website[]>([])
  const searchFilters = ref<SearchFilters>({ keyword: '', categoryIds: [], tagIds: [] })
  const sortField = ref<SortField>('order')
  const sortOrder = ref<SortOrder>('asc')
  const isSyncing = ref(false)

  const filteredWebsites = computed(() => {
    let result = [...websites.value]
    const keyword = searchFilters.value.keyword.toLowerCase()
    if (keyword) {
      result = result.filter(
        website =>
          website.name.toLowerCase().includes(keyword) ||
          website.url.toLowerCase().includes(keyword) ||
          website.description?.toLowerCase().includes(keyword)
      )
    }
    if (searchFilters.value.categoryIds.length) {
      result = result.filter(website =>
        searchFilters.value.categoryIds.includes(website.categoryId)
      )
    }
    if (searchFilters.value.tagIds.length) {
      result = result.filter(website =>
        website.tagIds.some(tagId => searchFilters.value.tagIds.includes(tagId))
      )
    }
    result.sort((left, right) => {
      if (sortField.value === 'name') {
        const comparison = left.name.localeCompare(right.name)
        return sortOrder.value === 'asc' ? comparison : -comparison
      }
      const comparison = sortValue(left, sortField.value) - sortValue(right, sortField.value)
      return sortOrder.value === 'asc' ? comparison : -comparison
    })
    return result
  })

  const initializeData = async () => {
    isSyncing.value = true
    try {
      websites.value = await libraryApi.listBookmarks()
    } finally {
      isSyncing.value = false
    }
  }

  const addWebsite = async (input: Omit<Website, 'id' | 'version'>) => {
    const created = await libraryApi.createBookmark(input)
    websites.value = [...websites.value, created]
    return created
  }

  const updateWebsite = async (id: string, updates: Partial<Website>) => {
    const current = websites.value.find(item => item.id === id)
    if (!current) return undefined
    try {
      const updated = await libraryApi.updateBookmark(id, current.version, updates)
      replace(updated)
      return updated
    } catch (error) {
      await initializeData()
      throw error
    }
  }

  const deleteWebsite = async (id: string) => {
    await bulkDeleteWebsites([id])
  }

  const bulkDeleteWebsites = async (ids: string[]) => {
    const selected = websites.value.filter(item => ids.includes(item.id))
    if (selected.length === 0) return
    try {
      await libraryApi.bulkDeleteBookmarks(
        selected.map(item => ({ id: item.id, version: item.version }))
      )
      const deletedIds = new Set(selected.map(item => item.id))
      websites.value = websites.value.filter(item => !deletedIds.has(item.id))
    } catch (error) {
      await initializeData()
      throw error
    }
  }

  const incrementVisitCount = async (id: string) => {
    const current = websites.value.find(item => item.id === id)
    if (!current) return
    try {
      replace(await libraryApi.visitBookmark(id, current.version))
    } catch {
      await initializeData()
    }
  }

  const moveWebsiteBefore = async (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return
    const reordered = moveBefore(websites.value, sourceId, targetId)
    if (!reordered) return
    try {
      websites.value = await libraryApi.reorderBookmarks(reordered)
    } catch (error) {
      await initializeData()
      throw error
    }
  }

  const moveFavoriteBefore = async (sourceId: string, targetId: string) => {
    const favorites = websites.value
      .filter(item => item.isFavorite)
      .sort((left, right) => (left.favoriteOrder ?? 0) - (right.favoriteOrder ?? 0))
    const reordered = moveBefore(favorites, sourceId, targetId)
    if (!reordered) return
    try {
      const updated = await libraryApi.reorderBookmarks(reordered, true)
      const byId = new Map(updated.map(item => [item.id, item]))
      websites.value = websites.value.map(item => byId.get(item.id) ?? item)
    } catch (error) {
      await initializeData()
      throw error
    }
  }

  const replace = (website: Website) => {
    websites.value = websites.value.map(item => (item.id === website.id ? website : item))
  }
  const setSearchFilters = (filters: Partial<SearchFilters>) =>
    Object.assign(searchFilters.value, filters)
  const clearSearch = () => {
    searchFilters.value = { keyword: '', categoryIds: [], tagIds: [] }
  }
  const setSorting = (field: SortField, order: SortOrder) => {
    sortField.value = field
    sortOrder.value = order
  }

  return {
    websites,
    searchFilters: readonly(searchFilters),
    sortField: readonly(sortField),
    sortOrder: readonly(sortOrder),
    isSyncing: readonly(isSyncing),
    filteredWebsites,
    initializeData,
    addWebsite,
    updateWebsite,
    deleteWebsite,
    bulkDeleteWebsites,
    incrementVisitCount,
    moveWebsiteBefore,
    moveFavoriteBefore,
    setSearchFilters,
    clearSearch,
    setSorting
  }
})

function moveBefore(items: Website[], sourceId: string, targetId: string): Website[] | undefined {
  const sourceIndex = items.findIndex(item => item.id === sourceId)
  const targetIndex = items.findIndex(item => item.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0) return undefined
  const reordered = [...items]
  const [moved] = reordered.splice(sourceIndex, 1)
  reordered.splice(
    reordered.findIndex(item => item.id === targetId),
    0,
    moved
  )
  return reordered
}

function sortValue(website: Website, field: SortField): number {
  if (field === 'createdAt') return website.createdAt.getTime()
  if (field === 'visitCount') return website.visitCount
  if (field === 'lastVisited') return website.lastVisited?.getTime() ?? 0
  return website.order ?? 0
}
