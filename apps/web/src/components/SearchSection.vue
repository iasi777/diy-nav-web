<template>
  <div class="search-section">
    <!-- Search Header -->
    <div v-if="!hideSearch" class="search-header-wrapper">
      <SearchHeader v-model="searchKeyword" />
    </div>

    <div class="content-layout">
      <!-- Sidebar Filters -->
      <SidebarFilters
        v-if="showFilters"
        :tags="tags"
        :categories="categories"
        :selected-tags="selectedTags"
        :selected-category="selectedCategory"
        @toggle-tag="toggleTag"
        @select-category="selectCategory"
        @manage-tags="emit('manageTags')"
        @manage-categories="emit('manageCategories')"
      />

      <!-- Main Content -->
      <main class="main-content">
        <!-- Selected Conditions Bar -->
        <ActiveFiltersBar
          v-if="hasActiveFilters"
          :selected-tags="selectedTags"
          :selected-category="selectedCategory"
          :tags="tags"
          :categories="categories"
          @toggle-tag="toggleTag"
          @select-category="selectCategory"
          @clear-all="clearAllFilters"
        />

        <div v-if="canBulkDelete" class="bulk-toolbar">
          <BaseButton variant="ghost" size="sm" @click="toggleBulkMode">
            <i :class="bulkMode ? 'fas fa-times' : 'fas fa-check-square'" />
            {{ bulkMode ? '退出批量模式' : '批量删除' }}
          </BaseButton>
          <template v-if="bulkMode">
            <label class="select-all">
              <input
                type="checkbox"
                :checked="allCurrentSelected"
                :disabled="currentResults.length === 0"
                @change="toggleSelectAllCurrent"
              />
              全选当前结果
            </label>
            <span class="selected-count">已选 {{ selectedWebsiteIds.length }} 项</span>
            <BaseButton
              variant="danger"
              size="sm"
              :disabled="selectedWebsiteIds.length === 0"
              @click="showBulkDeleteConfirm = true"
            >
              删除所选
            </BaseButton>
          </template>
        </div>

        <!-- Search Results -->
        <div v-if="searchKeyword && !hideSearch" class="search-results-section">
          <div class="results-header">
            <h3>搜索结果</h3>
            <BaseButton
              variant="ghost"
              size="sm"
              shape="pill"
              class="action-btn"
              @click="clearSearch"
            >
              <i class="fas fa-times" />
              清空搜索
            </BaseButton>
          </div>
          <div v-if="searchResults.length > 0" class="website-grid">
            <div
              v-for="site in searchResults"
              :key="site.id"
              class="website-selectable"
              :class="{ selected: selectedWebsiteIds.includes(site.id) }"
            >
              <label v-if="bulkMode" class="website-selector" @click.stop>
                <input
                  type="checkbox"
                  :checked="selectedWebsiteIds.includes(site.id)"
                  @change="toggleWebsiteSelection(site.id)"
                />
              </label>
              <WebsiteCard
                :website="site"
                :clickable="!bulkMode"
                :show-actions="!bulkMode"
                :draggable="false"
                @visit="onVisit"
                @edit="emit('edit', site)"
                @delete="emit('delete', site.id)"
                @favorite-toggle="onFavoriteToggle"
              />
            </div>
          </div>
          <EmptyState
            v-else
            type="no-results"
            :message="`未找到与“${searchKeyword}”相关的结果`"
            :show-action-button="false"
          />
        </div>

        <!-- Filtered Grid -->
        <div v-else>
          <InfiniteWebsiteGrid :websites="filteredWebsites" :page-size="30" :initial-size="30">
            <template #default="{ website }">
              <div
                class="website-draggable"
                :class="{ selected: selectedWebsiteIds.includes(website.id) }"
                :draggable="!bulkMode"
                @dragstart="!bulkMode && onDragStart(website.id, $event)"
                @dragover="!bulkMode && onDragOver(website.id, $event)"
                @drop="!bulkMode && onDrop(website.id, $event)"
                @dragend="onDragEnd"
              >
                <label v-if="bulkMode" class="website-selector" @click.stop>
                  <input
                    type="checkbox"
                    :checked="selectedWebsiteIds.includes(website.id)"
                    @change="toggleWebsiteSelection(website.id)"
                  />
                </label>
                <WebsiteCard
                  :website="website"
                  :clickable="!bulkMode"
                  :show-actions="!bulkMode"
                  :draggable="!bulkMode"
                  @visit="onVisit"
                  @edit="emit('edit', website)"
                  @delete="emit('delete', website.id)"
                  @favorite-toggle="onFavoriteToggle"
                />
              </div>
            </template>

            <template v-if="filteredWebsites.length > 0 && !bulkMode" #add-card>
              <div class="add-card" @click="onAddSite">
                <div class="add-card-content">
                  <div class="add-icon">
                    <i class="fas fa-plus" />
                  </div>
                  <span>添加网站</span>
                </div>
              </div>
            </template>
          </InfiniteWebsiteGrid>
        </div>

        <EmptyState
          v-if="filteredWebsites.length === 0 && !searchKeyword"
          type="no-websites"
          message="暂时还没有网站"
          description="点击下方按钮，添加你的第一个网站。之后你可以在「全部」中按标签、分类和关键字进行筛选和搜索。"
          hint="小提示：建议为常用网站设置分类和标签，后续管理和查找会更轻松。"
          :show-action-button="true"
          size="small"
        >
          <template #action>
            <BaseButton variant="primary" size="md" shape="pill" @click="onAddSite">
              <i class="fas fa-plus" />
              添加第一个网站
            </BaseButton>
          </template>
        </EmptyState>
      </main>
    </div>

    <BaseModal
      :is-open="showBulkDeleteConfirm"
      title="批量删除网站"
      size="sm"
      @close="showBulkDeleteConfirm = false"
    >
      <p class="bulk-confirm-text">
        确定删除已选中的 {{ selectedWebsiteIds.length }} 个网站吗？此操作不可恢复。
      </p>
      <template #footer>
        <div class="bulk-confirm-actions">
          <BaseButton variant="ghost" @click="showBulkDeleteConfirm = false">取消</BaseButton>
          <BaseButton variant="danger" :loading="bulkDeleting" @click="confirmBulkDelete">
            删除
          </BaseButton>
        </div>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
/**
 * @component SearchSection
 * @description 网站搜索与过滤主组件
 * 包含搜索框、标签筛选、分类筛选以及网站列表展示
 * 集成了搜索逻辑、拖拽排序等功能
 *
 * @props fixedView - 固定视图模式 ('recent' | 'favorite' | 'all')
 * @props hideSearch - 是否隐藏搜索框
 *
 * @emits edit - 编辑网站
 * @emits delete - 删除网站
 * @emits addSite - 添加新网站
 * @emits manageTags - 打开标签管理
 * @emits manageCategories - 打开分类管理
 */
import { computed, ref, watch } from 'vue'
import WebsiteCard from '@/components/WebsiteCard.vue'
import InfiniteWebsiteGrid from '@/components/InfiniteWebsiteGrid.vue'
import { EmptyState, BaseButton, BaseModal } from '@nav/ui'
import { useWebsiteStore } from '@/stores/website'
import { useUIStore } from '@/stores/ui'
import { useWebsiteSearch } from '@/composables/useWebsiteSearch'
import { useWebsiteDrag } from '@/composables/useWebsiteDrag'
import type { Website } from '@/types'

// Sub-components
import SearchHeader from './search/SearchHeader.vue'
import SidebarFilters from './search/SidebarFilters.vue'
import ActiveFiltersBar from './search/ActiveFiltersBar.vue'

interface Props {
  fixedView?: 'recent' | 'favorite' | 'all'
  hideSearch?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  hideSearch: false
})

const emit = defineEmits(['edit', 'delete', 'addSite', 'manageTags', 'manageCategories'])

const websiteStore = useWebsiteStore()
const uiStore = useUIStore()

// 使用组合式函数
const {
  searchKeyword,
  selectedTags,
  selectedCategory,
  showFilters,
  tags,
  categories,
  filteredWebsites,
  searchResults,
  toggleTag,
  selectCategory,
  clearSearch,
  clearSelectedTags
} = useWebsiteSearch(() => props.fixedView)

const { onDragStart, onDragOver, onDrop, onDragEnd } = useWebsiteDrag(() => props.fixedView)

const hasActiveFilters = computed(() => {
  return selectedTags.value.length > 0 || selectedCategory.value !== 'all'
})
const canBulkDelete = computed(() => props.fixedView === 'all')
const bulkMode = ref(false)
const selectedWebsiteIds = ref<string[]>([])
const showBulkDeleteConfirm = ref(false)
const bulkDeleting = ref(false)
const currentResults = computed(() =>
  searchKeyword.value && !props.hideSearch ? searchResults.value : filteredWebsites.value
)
const allCurrentSelected = computed(
  () =>
    currentResults.value.length > 0 &&
    currentResults.value.every(website => selectedWebsiteIds.value.includes(website.id))
)

const clearAllFilters = () => {
  selectCategory('all')
  clearSelectedTags()
}

const onAddSite = () => {
  const contextCategoryId = selectedCategory.value !== 'all' ? selectedCategory.value : ''
  emit('addSite', contextCategoryId)
}

const onVisit = (website: Website) => {
  void websiteStore.incrementVisitCount(website.id)
  window.open(website.url, '_blank', 'noopener,noreferrer')
}

const onFavoriteToggle = (websiteId: string) => {
  const w = websiteStore.websites.find(x => x.id === websiteId)
  if (!w) return
  void websiteStore.updateWebsite(websiteId, { isFavorite: !w.isFavorite }).catch(() => undefined)
}

const toggleBulkMode = () => {
  bulkMode.value = !bulkMode.value
  if (!bulkMode.value) selectedWebsiteIds.value = []
}

const toggleWebsiteSelection = (id: string) => {
  selectedWebsiteIds.value = selectedWebsiteIds.value.includes(id)
    ? selectedWebsiteIds.value.filter(selectedId => selectedId !== id)
    : [...selectedWebsiteIds.value, id]
}

const toggleSelectAllCurrent = () => {
  const currentIds = currentResults.value.map(website => website.id)
  if (allCurrentSelected.value) {
    const currentSet = new Set(currentIds)
    selectedWebsiteIds.value = selectedWebsiteIds.value.filter(id => !currentSet.has(id))
  } else {
    selectedWebsiteIds.value = [...new Set([...selectedWebsiteIds.value, ...currentIds])]
  }
}

const confirmBulkDelete = async () => {
  if (selectedWebsiteIds.value.length === 0 || bulkDeleting.value) return
  bulkDeleting.value = true
  try {
    const count = selectedWebsiteIds.value.length
    await websiteStore.bulkDeleteWebsites(selectedWebsiteIds.value)
    uiStore.showToast(`已删除 ${count} 个网站`, 'success')
    selectedWebsiteIds.value = []
    bulkMode.value = false
    showBulkDeleteConfirm.value = false
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '批量删除失败', 'error')
  } finally {
    bulkDeleting.value = false
  }
}

watch(
  () => websiteStore.websites,
  current => {
    const validIds = new Set(current.map(website => website.id))
    selectedWebsiteIds.value = selectedWebsiteIds.value.filter(id => validIds.has(id))
  }
)

watch(canBulkDelete, enabled => {
  if (!enabled) {
    bulkMode.value = false
    selectedWebsiteIds.value = []
  }
})
</script>

<style scoped lang="scss">
@use '@/styles/variables' as *;
@use '@/styles/mixins' as *;

.search-section {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.search-header-wrapper {
  margin-bottom: 0.5rem;
}

.content-layout {
  display: flex;
  gap: 1.5rem;
  align-items: flex-start;
}

/* Main Content Styles */
.main-content {
  flex: 1;
  min-width: 0;
}

.bulk-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 1rem;
  padding: 10px 12px;
  border: 1px solid var(--border-tile);
  border-radius: 12px;
  background-color: var(--bg-panel);
}

.select-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
}

.selected-count {
  color: var(--text-muted);
  font-size: 13px;
}

.search-results-section {
  margin-top: 1.5rem;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;

  h3 {
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
    color: var(--text-main);
  }
}

.website-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1.25rem;
}

.website-draggable {
  position: relative;
  cursor: grab;
  min-width: 0; /* Critical for grid/flex overflow */
  width: 100%;

  &:active {
    cursor: grabbing;
  }

  &.selected {
    outline: 2px solid var(--color-primary);
    border-radius: var(--radius-lg);
  }
}

.website-selectable {
  position: relative;
  min-width: 0;

  &.selected {
    outline: 2px solid var(--color-primary);
    border-radius: var(--radius-lg);
  }
}

.website-selector {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 3;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background-color: var(--bg-panel);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
}

.bulk-confirm-text {
  color: var(--text-main);
  line-height: 1.6;
}

.bulk-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  width: 100%;
}

.add-card {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 160px;
  background-color: var(--bg-panel);
  border: 1px dashed var(--border-tile);
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: var(--color-primary);
    background-color: rgba(37, 99, 235, 0.02);

    .add-icon {
      background-color: var(--color-primary);
      color: var(--color-white);
      transform: scale(1.1);
    }

    span {
      color: var(--color-primary);
    }
  }
}

.add-card-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;

  span {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-secondary);
    transition: color 0.2s;
  }
}

.add-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background-color: var(--bg-body);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  transition: all 0.2s;
}

@include mobile {
  .search-section {
    gap: 1rem;
  }

  .content-layout {
    flex-direction: column;
    gap: 1rem;
  }

  /* Sidebar becomes a horizontal scrollable bar on mobile */
  :deep(.sidebar-filters) {
    width: 100%;
    position: static;
    max-height: none;
    padding: 0;
    background: transparent;
    gap: 1rem;
    overflow: visible;
  }

  :deep(.filter-group) {
    background-color: var(--bg-panel);
    padding: 1rem;
    border-radius: 12px;
    width: 100%;
    max-height: none;
    flex: none;
  }

  :deep(.filter-content) {
    overflow: visible;
  }

  :deep(.tag-list),
  :deep(.category-list) {
    flex-flow: row nowrap;
    overflow-x: auto;
    padding-bottom: 4px;
    -webkit-overflow-scrolling: touch;
    align-items: center; /* Prevent items from stretching vertically */

    /* Hide scrollbar */
    scrollbar-width: none;
    &::-webkit-scrollbar {
      display: none;
    }
  }

  :deep(.tag-pill) {
    white-space: nowrap;
    flex-shrink: 0;
  }

  :deep(.category-item) {
    white-space: nowrap;
    flex-shrink: 0;
    background-color: var(--bg-tile);
    border: 1px solid var(--border-tile);
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 12px;

    &.active {
      background-color: rgba(37, 99, 235, 0.1);
      color: var(--color-primary);
      border-color: var(--color-primary);
      box-shadow: none;
    }
  }

  .website-grid {
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  .add-card {
    min-height: 120px;
    flex-direction: row;
    gap: 1rem;

    .add-icon {
      width: 48px;
      height: 48px;
      font-size: 20px;
    }

    span {
      font-size: 14px;
    }
  }
}
</style>
```
