import { readonly, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Category } from '@/types'
import { libraryApi } from '@/api/library'

export const useCategoryStore = defineStore('category', () => {
  const categories = ref<Category[]>([])
  const searchFilters = ref({ keyword: '', categoryIds: [] as string[] })

  const initializeData = async () => {
    categories.value = await libraryApi.listCategories()
  }
  const addCategory = async (input: Pick<Category, 'name' | 'description' | 'icon'>) => {
    const created = await libraryApi.createCategory(input)
    categories.value = [...categories.value, created]
    return created
  }
  const updateCategory = async (id: string, updates: Partial<Category>) => {
    const current = categories.value.find(item => item.id === id)
    if (!current) return undefined
    try {
      const updated = await libraryApi.updateCategory(id, current.version, updates)
      categories.value = categories.value.map(item => (item.id === id ? updated : item))
      return updated
    } catch (error) {
      await initializeData()
      throw error
    }
  }
  const deleteCategory = async (id: string) => {
    await bulkDeleteCategories([id])
  }
  const bulkDeleteCategories = async (ids: string[]) => {
    const selected = categories.value.filter(item => ids.includes(item.id))
    if (selected.length === 0) return
    try {
      await libraryApi.bulkDeleteCategories(
        selected.map(item => ({ id: item.id, version: item.version }))
      )
      const deletedIds = new Set(selected.map(item => item.id))
      categories.value = categories.value.filter(item => !deletedIds.has(item.id))
    } catch (error) {
      await initializeData()
      throw error
    }
  }
  const reorderCategories = async (ids: string[]) => {
    const items = ids
      .map(id => categories.value.find(item => item.id === id))
      .filter((item): item is Category => Boolean(item))
    try {
      categories.value = await libraryApi.reorderCategories(items)
    } catch (error) {
      await initializeData()
      throw error
    }
  }
  const setSearchFilters = (filters: Partial<typeof searchFilters.value>) =>
    Object.assign(searchFilters.value, filters)
  const clearSearchFilters = () => {
    searchFilters.value = { keyword: '', categoryIds: [] }
  }
  const getCategoryById = (id: string) => categories.value.find(item => item.id === id)

  return {
    categories: readonly(categories),
    searchFilters,
    initializeData,
    addCategory,
    updateCategory,
    deleteCategory,
    bulkDeleteCategories,
    reorderCategories,
    setSearchFilters,
    clearSearchFilters,
    getCategoryById
  }
})
