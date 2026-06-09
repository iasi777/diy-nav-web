<template>
  <div class="data-management">
    <section class="panel">
      <div class="section-heading">
        <div>
          <h3>批量导入</h3>
          <p>支持浏览器 Netscape Bookmark HTML 和项目 JSON。文件内容只发送到本机 API。</p>
        </div>
        <BaseButton variant="primary" :loading="uploading" @click="fileInput?.click()">
          选择文件
        </BaseButton>
        <input
          ref="fileInput"
          hidden
          type="file"
          accept=".html,.htm,.json,text/html,application/json"
          @change="handleUpload"
        />
      </div>

      <div v-if="batch" class="batch">
        <div class="summary">
          <strong>{{ batch.filename }}</strong>
          <span>有效 {{ batch.counts.valid || 0 }}</span>
          <span>待提交 {{ batch.counts.ready || 0 }}</span>
          <span>重复 {{ batch.counts.duplicate || 0 }}</span>
          <span>异常 {{ batch.counts.invalid || 0 }}</span>
          <span class="status">{{ statusLabel }}</span>
        </div>

        <fieldset class="batch-workflow" :disabled="batchFinalized">
          <div class="taxonomy">
            <div class="subheading">
              <h4>分类体系</h4>
              <div class="actions">
                <select v-model="selectedModel">
                  <option value="">选择 new-api 模型</option>
                  <option v-for="model in models" :key="model" :value="model">{{ model }}</option>
                </select>
                <BaseButton
                  variant="outline"
                  size="sm"
                  :disabled="!selectedModel"
                  :loading="proposing"
                  @click="handlePropose"
                >
                  AI 建议分类
                </BaseButton>
              </div>
            </div>
            <div class="taxonomy-list">
              <div v-for="(category, index) in taxonomy" :key="index" class="taxonomy-row">
                <input v-model="category.name" placeholder="分类名称" />
                <input v-model="category.description" placeholder="说明（可选）" />
                <button type="button" title="删除" @click="taxonomy.splice(index, 1)">×</button>
              </div>
            </div>
            <button type="button" class="text-button" @click="taxonomy.push({ name: '' })">
              + 添加分类
            </button>
            <div class="workflow-actions">
              <BaseButton variant="outline" :loading="savingTaxonomy" @click="saveTaxonomy">
                保存分类体系
              </BaseButton>
              <BaseButton
                variant="primary"
                :disabled="!selectedModel || taxonomy.length === 0"
                :loading="classifying"
                @click="startClassification"
              >
                开始 AI 分类
              </BaseButton>
            </div>
          </div>

          <div v-if="classifying" class="progress">
            <div
              class="progress-bar"
              :style="{
                width: `${Math.round((batch.processedItems / Math.max(1, batch.totalItems)) * 100)}%`
              }"
            />
            <span>{{ batch.processedItems }} / {{ batch.totalItems }}</span>
          </div>
          <p v-if="batch.errorMessage" class="error">{{ batch.errorMessage }}</p>

          <div class="review">
            <div class="subheading">
              <h4>逐条审核</h4>
              <span>可按状态筛选和批量修改；重复和异常条目默认不会提交。</span>
            </div>
            <div class="review-tools">
              <select v-model="reviewStatus" aria-label="筛选状态">
                <option value="">全部状态</option>
                <option value="valid">有效，待分类</option>
                <option value="ready">待提交</option>
                <option value="duplicate">重复</option>
                <option value="invalid">异常</option>
                <option value="error">分类失败</option>
                <option value="excluded">已排除</option>
              </select>
              <label class="select-all">
                <input
                  type="checkbox"
                  :checked="allVisibleSelected"
                  :disabled="visibleItems.length === 0"
                  @change="toggleVisibleSelection"
                />
                选择当前 {{ visibleItems.length }} 条
              </label>
              <span>已选 {{ selectedIds.length }} 条</span>
            </div>
            <div class="bulk-tools">
              <input v-model="bulkCategory" placeholder="批量分类" />
              <input v-model="bulkTags" placeholder="批量标签，以逗号分隔" />
              <BaseButton
                size="sm"
                variant="outline"
                :disabled="selectedIds.length === 0 || (!bulkCategory.trim() && !bulkTags.trim())"
                :loading="bulkSaving"
                @click="applyBulkMetadata"
              >
                应用分类/标签
              </BaseButton>
              <BaseButton
                size="sm"
                variant="ghost"
                :disabled="selectedIds.length === 0"
                :loading="bulkSaving"
                @click="setBulkExcluded(true)"
              >
                批量排除
              </BaseButton>
              <BaseButton
                size="sm"
                variant="ghost"
                :disabled="selectedIds.length === 0"
                :loading="bulkSaving"
                @click="setBulkExcluded(false)"
              >
                标记已审核 / 恢复
              </BaseButton>
            </div>
            <div class="review-list">
              <article v-for="item in visibleItems" :key="item.id" class="review-item">
                <div class="review-title">
                  <input
                    class="item-selector"
                    type="checkbox"
                    :checked="selectedIds.includes(item.id)"
                    aria-label="选择审核项"
                    @change="toggleItemSelection(item.id)"
                  />
                  <span class="badge" :class="item.status">{{ item.status }}</span>
                  <input v-model="item.title" aria-label="标题" />
                  <label>
                    <input
                      type="checkbox"
                      :checked="item.status === 'excluded'"
                      @change="toggleExcluded(item, $event)"
                    />
                    排除
                  </label>
                </div>
                <input v-model="item.url" aria-label="URL" />
                <div class="review-grid">
                  <input v-model="item.categoryName" placeholder="分类" />
                  <input
                    :value="item.tags.join(', ')"
                    placeholder="标签，以逗号分隔"
                    @input="updateTags(item, $event)"
                  />
                </div>
                <textarea v-model="item.description" rows="2" placeholder="简短描述" />
                <div class="review-footer">
                  <span>{{ item.folderPath || '根目录' }}</span>
                  <span v-if="item.errorMessage" class="error">{{ item.errorMessage }}</span>
                  <BaseButton size="sm" variant="outline" @click="saveItem(item)">保存</BaseButton>
                </div>
              </article>
            </div>
            <div v-if="!batchFinalized" class="workflow-actions">
              <BaseButton variant="ghost" @click="cancelImport">取消批次</BaseButton>
              <BaseButton
                variant="primary"
                :disabled="!batch.items.some(item => item.status === 'ready')"
                :loading="committing"
                @click="commitImport"
              >
                提交已审核条目
              </BaseButton>
            </div>
          </div>
        </fieldset>
      </div>
    </section>

    <section class="panel compact">
      <div>
        <h3>导出与清理</h3>
        <p>JSON 导出不包含 AI Key。清理操作会删除中心库中的全部书签数据。</p>
      </div>
      <div class="actions">
        <BaseButton variant="outline" :loading="exporting" @click="exportJson">
          导出 JSON
        </BaseButton>
        <BaseButton variant="danger" :loading="clearing" @click="clearLibrary">
          清除全部数据
        </BaseButton>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { BaseButton } from '@nav/ui'
import { importsApi, type ImportBatch, type ImportItem } from '@/api/imports'
import { libraryApi } from '@/api/library'
import { useWebsiteStore } from '@/stores/website'
import { useCategoryStore } from '@/stores/category'
import { useTagStore } from '@/stores/tag'
import { useUIStore } from '@/stores/ui'

defineEmits<{ close: [] }>()

const websiteStore = useWebsiteStore()
const categoryStore = useCategoryStore()
const tagStore = useTagStore()
const uiStore = useUIStore()
const fileInput = ref<HTMLInputElement>()
const batch = ref<ImportBatch>()
const taxonomy = ref<Array<{ name: string; description?: string }>>([])
const models = ref<string[]>([])
const selectedModel = ref('')
const uploading = ref(false)
const proposing = ref(false)
const savingTaxonomy = ref(false)
const committing = ref(false)
const exporting = ref(false)
const clearing = ref(false)
const bulkSaving = ref(false)
const reviewStatus = ref('')
const selectedIds = ref<string[]>([])
const bulkCategory = ref('')
const bulkTags = ref('')
let pollTimer: number | undefined

const classifying = computed(() =>
  batch.value ? ['queued', 'classifying'].includes(batch.value.status) : false
)
const batchFinalized = computed(() =>
  batch.value ? ['committed', 'cancelled'].includes(batch.value.status) : false
)
const visibleItems = computed(() =>
  (batch.value?.items ?? []).filter(
    item => !reviewStatus.value || item.status === reviewStatus.value
  )
)
const allVisibleSelected = computed(
  () =>
    visibleItems.value.length > 0 &&
    visibleItems.value.every(item => selectedIds.value.includes(item.id))
)
const statusLabel = computed(
  () =>
    ({
      preview: '预览',
      taxonomy: '分类体系已确认',
      queued: '等待分类',
      classifying: 'AI 分类中',
      review: '等待审核',
      failed: '分类失败',
      committed: '已提交',
      cancelled: '已取消'
    })[batch.value?.status ?? 'preview']
)

importsApi
  .models()
  .then(items => {
    models.value = items
    selectedModel.value = items[0] ?? ''
  })
  .catch(() => {
    models.value = []
  })

const handleUpload = async (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  uploading.value = true
  try {
    setBatch(await importsApi.create(file.name, await file.text()))
    uiStore.showToast('文件解析完成', 'success')
  } catch (error) {
    uiStore.showToast(messageOf(error), 'error')
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

const setBatch = (value: ImportBatch) => {
  batch.value = value
  taxonomy.value = value.taxonomy.map(item => ({ ...item }))
  const itemIds = new Set(value.items.map(item => item.id))
  selectedIds.value = selectedIds.value.filter(id => itemIds.has(id))
  if (value.selectedModel) selectedModel.value = value.selectedModel
}

const saveTaxonomy = async (): Promise<boolean> => {
  if (!batch.value) return false
  savingTaxonomy.value = true
  try {
    const categories = taxonomy.value
      .map(item => ({ ...item, name: item.name.trim() }))
      .filter(item => item.name)
    setBatch(await importsApi.saveTaxonomy(batch.value.id, categories))
    uiStore.showToast('分类体系已保存', 'success')
    return true
  } catch (error) {
    uiStore.showToast(messageOf(error), 'error')
    return false
  } finally {
    savingTaxonomy.value = false
  }
}

const handlePropose = async () => {
  if (!batch.value || !selectedModel.value) return
  proposing.value = true
  try {
    setBatch(await importsApi.proposeTaxonomy(batch.value.id, selectedModel.value))
  } catch (error) {
    uiStore.showToast(messageOf(error), 'error')
  } finally {
    proposing.value = false
  }
}

const startClassification = async () => {
  if (!batch.value || !selectedModel.value) return
  try {
    if (!(await saveTaxonomy())) return
    setBatch(await importsApi.classify(batch.value.id, selectedModel.value))
    schedulePoll()
  } catch (error) {
    uiStore.showToast(messageOf(error), 'error')
  }
}

const schedulePoll = () => {
  window.clearTimeout(pollTimer)
  if (!batch.value || !classifying.value) return
  pollTimer = window.setTimeout(async () => {
    if (!batch.value) return
    try {
      setBatch(await importsApi.get(batch.value.id))
    } finally {
      schedulePoll()
    }
  }, 1200)
}

const saveItem = async (item: ImportItem) => {
  if (!batch.value) return
  try {
    setBatch(
      await importsApi.updateItem(batch.value.id, item, {
        title: item.title,
        url: item.url,
        categoryName: item.categoryName,
        tags: item.tags,
        description: item.description,
        excluded: item.status === 'excluded'
      })
    )
    uiStore.showToast('审核项已保存', 'success')
  } catch (error) {
    uiStore.showToast(messageOf(error), 'error')
  }
}

const toggleExcluded = (item: ImportItem, event: Event) => {
  item.status = (event.target as HTMLInputElement).checked ? 'excluded' : 'ready'
  void saveItem(item)
}
const updateTags = (item: ImportItem, event: Event) => {
  item.tags = (event.target as HTMLInputElement).value
    .split(/[,，]/)
    .map(tag => tag.trim())
    .filter(Boolean)
    .slice(0, 3)
}

const toggleItemSelection = (id: string) => {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter(itemId => itemId !== id)
    : [...selectedIds.value, id]
}

const toggleVisibleSelection = () => {
  const visibleIds = new Set(visibleItems.value.map(item => item.id))
  if (allVisibleSelected.value) {
    selectedIds.value = selectedIds.value.filter(id => !visibleIds.has(id))
  } else {
    selectedIds.value = [...new Set([...selectedIds.value, ...visibleIds])]
  }
}

const applyBulkMetadata = async () => {
  const tags = bulkTags.value
    .split(/[,，]/)
    .map(tag => tag.trim())
    .filter(Boolean)
    .slice(0, 3)
  await updateSelectedItems({
    ...(bulkCategory.value.trim() ? { categoryName: bulkCategory.value.trim() } : {}),
    ...(tags.length ? { tags } : {})
  })
}

const setBulkExcluded = async (excluded: boolean) => {
  await updateSelectedItems({ excluded })
}

const updateSelectedItems = async (
  updates: Partial<
    Pick<ImportItem, 'categoryName' | 'tags'> & {
      excluded: boolean
    }
  >
) => {
  if (!batch.value || selectedIds.value.length === 0) return
  bulkSaving.value = true
  try {
    const selected = batch.value.items.filter(item => selectedIds.value.includes(item.id))
    for (const item of selected) {
      await importsApi.updateItem(batch.value.id, item, updates)
    }
    setBatch(await importsApi.get(batch.value.id))
    selectedIds.value = []
    uiStore.showToast(`已更新 ${selected.length} 条审核项`, 'success')
  } catch (error) {
    setBatch(await importsApi.get(batch.value.id))
    uiStore.showToast(messageOf(error), 'error')
  } finally {
    bulkSaving.value = false
  }
}

const commitImport = async () => {
  if (!batch.value) return
  committing.value = true
  try {
    await importsApi.commit(batch.value.id)
    await Promise.all([
      websiteStore.initializeData(),
      categoryStore.initializeData(),
      tagStore.initializeData()
    ])
    setBatch(await importsApi.get(batch.value.id))
    uiStore.showToast('导入已提交到中心库', 'success')
  } catch (error) {
    uiStore.showToast(messageOf(error), 'error')
  } finally {
    committing.value = false
  }
}

const cancelImport = async () => {
  if (!batch.value) return
  setBatch(await importsApi.cancel(batch.value.id))
}

const exportJson = async () => {
  exporting.value = true
  try {
    const payload = await libraryApi.exportJson()
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(blob)
    anchor.download = `diy-nav-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(anchor.href)
  } finally {
    exporting.value = false
  }
}

const clearLibrary = async () => {
  if (!window.confirm('确定删除中心库中的全部书签、分类、标签和导入批次吗？')) return
  clearing.value = true
  try {
    await libraryApi.clear()
    await Promise.all([
      websiteStore.initializeData(),
      categoryStore.initializeData(),
      tagStore.initializeData()
    ])
    batch.value = undefined
    uiStore.showToast('中心库已清空', 'success')
  } finally {
    clearing.value = false
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : '操作失败')
onUnmounted(() => window.clearTimeout(pollTimer))
</script>

<style scoped lang="scss">
.data-management {
  display: grid;
  gap: 20px;
}
.panel {
  border: 1px solid var(--border-tile);
  border-radius: 14px;
  padding: 18px;
  background: var(--bg-panel);
}
.panel.compact,
.section-heading,
.subheading,
.summary,
.workflow-actions,
.review-title,
.review-footer,
.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
h3,
h4,
p {
  margin: 0;
}
p,
.subheading span,
.review-footer {
  color: var(--text-secondary);
  font-size: 13px;
}
.batch,
.taxonomy,
.review {
  display: grid;
  gap: 14px;
  margin-top: 18px;
}
.batch-workflow {
  display: grid;
  gap: 14px;
  min-inline-size: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.summary {
  justify-content: flex-start;
  flex-wrap: wrap;
}
.status {
  margin-left: auto;
  color: var(--color-primary);
}
select,
input,
textarea {
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--border-tile);
  border-radius: 8px;
  color: var(--text-main);
  background: var(--bg-tile);
}
.taxonomy-list,
.review-list {
  display: grid;
  gap: 10px;
}
.review-tools,
.bulk-tools {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) auto auto;
  align-items: center;
  gap: 8px;
}
.bulk-tools {
  grid-template-columns: 1fr 1fr auto auto auto;
}
.select-all {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.select-all input,
.item-selector {
  width: auto;
}
.taxonomy-row {
  display: grid;
  grid-template-columns: 1fr 2fr auto;
  gap: 8px;
}
.taxonomy-row button,
.text-button {
  border: 0;
  color: var(--color-primary);
  background: transparent;
  cursor: pointer;
}
.progress {
  position: relative;
  height: 28px;
  overflow: hidden;
  border-radius: 8px;
  background: var(--bg-tile);
  text-align: center;
  line-height: 28px;
}
.progress-bar {
  position: absolute;
  inset: 0 auto 0 0;
  background: rgba(59, 130, 246, 0.25);
}
.progress span {
  position: relative;
}
.review-list {
  max-height: 480px;
  overflow: auto;
}
.review-item {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border-tile);
  border-radius: 10px;
}
.review-title input {
  flex: 1;
}
.review-title .item-selector {
  flex: 0 0 auto;
}
.review-title label {
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.review-title label input {
  width: auto;
}
.review-grid {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 8px;
}
.badge {
  padding: 3px 7px;
  border-radius: 999px;
  font-size: 11px;
  background: var(--bg-tile);
}
.badge.ready {
  color: #059669;
}
.badge.duplicate,
.badge.invalid,
.badge.error,
.error {
  color: var(--color-error);
}
@media (max-width: 720px) {
  .panel.compact,
  .section-heading,
  .subheading {
    align-items: stretch;
    flex-direction: column;
  }
  .review-grid,
  .taxonomy-row,
  .review-tools,
  .bulk-tools {
    grid-template-columns: 1fr;
  }
}
</style>
