import { request } from '@/utils/http'
import { unwrap } from './library'

export interface ImportTaxonomyCategory {
  name: string
  description?: string
}

export interface ImportItem {
  id: string
  sourceIndex: number
  title: string
  url: string
  normalizedUrl?: string
  folderPath: string
  status: 'valid' | 'duplicate' | 'invalid' | 'ready' | 'excluded' | 'error'
  duplicateBookmarkId?: string
  categoryName?: string
  tags: string[]
  description?: string
  errorMessage?: string
  version: number
}

export interface ImportBatch {
  id: string
  filename: string
  format: 'html' | 'json'
  status:
    | 'preview'
    | 'taxonomy'
    | 'queued'
    | 'classifying'
    | 'review'
    | 'failed'
    | 'committed'
    | 'cancelled'
  taxonomy: ImportTaxonomyCategory[]
  selectedModel?: string
  totalItems: number
  processedItems: number
  errorMessage?: string
  counts: Record<string, number>
  items: ImportItem[]
}

export const importsApi = {
  models: async () => unwrap(await request.get<string[]>('/api/ai/models')),
  create: async (filename: string, content: string) =>
    unwrap(await request.post<ImportBatch>('/api/imports', { filename, content })),
  get: async (id: string) => unwrap(await request.get<ImportBatch>(`/api/imports/${id}`)),
  saveTaxonomy: async (id: string, categories: ImportTaxonomyCategory[]) =>
    unwrap(
      await request.put<ImportBatch>(`/api/imports/${id}/taxonomy`, {
        categories
      })
    ),
  proposeTaxonomy: async (id: string, model: string) =>
    unwrap(await request.post<ImportBatch>(`/api/imports/${id}/taxonomy/propose`, { model })),
  classify: async (id: string, model: string) =>
    unwrap(await request.post<ImportBatch>(`/api/imports/${id}/classify`, { model })),
  updateItem: async (
    batchId: string,
    item: ImportItem,
    updates: Partial<
      Pick<ImportItem, 'title' | 'url' | 'categoryName' | 'tags' | 'description'> & {
        excluded: boolean
      }
    >
  ) =>
    unwrap(
      await request.patch<ImportBatch>(`/api/imports/${batchId}/items/${item.id}`, {
        version: item.version,
        ...updates
      })
    ),
  commit: async (id: string, itemIds?: string[]) =>
    unwrap(await request.post(`/api/imports/${id}/commit`, { itemIds })),
  cancel: async (id: string) => unwrap(await request.post<ImportBatch>(`/api/imports/${id}/cancel`))
}
