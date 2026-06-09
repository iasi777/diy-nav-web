import { computed, readonly, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Tag } from '@/types'
import { libraryApi } from '@/api/library'

const TAG_COLORS = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#6B7280']

export const useTagStore = defineStore('tag', () => {
  const tags = ref<Tag[]>([])
  const tagColors = computed(() => TAG_COLORS)

  const initializeData = async () => {
    tags.value = await libraryApi.listTags()
  }
  const addTag = async (input: Pick<Tag, 'name' | 'color'>) => {
    const created = await libraryApi.createTag(input)
    tags.value = [...tags.value, created]
    return created
  }
  const updateTag = async (id: string, updates: Partial<Tag>) => {
    const current = tags.value.find(item => item.id === id)
    if (!current) return undefined
    try {
      const updated = await libraryApi.updateTag(id, current.version, updates)
      tags.value = tags.value.map(item => (item.id === id ? updated : item))
      return updated
    } catch (error) {
      await initializeData()
      throw error
    }
  }
  const deleteTag = async (id: string) => {
    await bulkDeleteTags([id])
  }
  const bulkDeleteTags = async (ids: string[]) => {
    const selected = tags.value.filter(item => ids.includes(item.id))
    if (selected.length === 0) return
    try {
      await libraryApi.bulkDeleteTags(
        selected.map(item => ({ id: item.id, version: item.version }))
      )
      const deletedIds = new Set(selected.map(item => item.id))
      tags.value = tags.value.filter(item => !deletedIds.has(item.id))
    } catch (error) {
      await initializeData()
      throw error
    }
  }
  const reorderTags = async (ids: string[]) => {
    const items = ids
      .map(id => tags.value.find(item => item.id === id))
      .filter((item): item is Tag => Boolean(item))
    try {
      tags.value = await libraryApi.reorderTags(items)
    } catch (error) {
      await initializeData()
      throw error
    }
  }
  const getTagById = (id: string) => tags.value.find(item => item.id === id)

  return {
    tags: readonly(tags),
    tagColors,
    initializeData,
    addTag,
    updateTag,
    deleteTag,
    bulkDeleteTags,
    reorderTags,
    getTagById
  }
})
