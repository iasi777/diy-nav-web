<template>
  <div class="manage-categories-modal">
    <div class="modal-content-wrapper">
      <!-- Category List -->
      <div class="category-list-container">
        <div v-if="categories.length > 0" class="bulk-management">
          <label class="select-all">
            <input type="checkbox" :checked="allSelected" @change="toggleSelectAll" />
            全选
          </label>
          <span>已选 {{ selectedIds.length }} 项</span>
          <BaseButton
            variant="danger"
            size="sm"
            :disabled="selectedIds.length === 0"
            @click="confirmBulkDelete"
          >
            批量删除
          </BaseButton>
        </div>

        <!-- Empty State -->
        <EmptyState
          v-if="categories.length === 0"
          type="no-categories"
          :show-action-button="false"
          size="small"
        />

        <TransitionGroup v-else name="list" tag="div" class="category-list">
          <div
            v-for="category in categories"
            :key="category.id"
            class="category-item"
            :class="{ 'is-editing': editingId === category.id }"
            draggable="true"
            @dragstart="onDragStart($event, category)"
            @dragover="onDragOver"
            @drop="onDrop($event, category)"
            @dragend="onDragEnd"
          >
            <!-- Inline Edit Mode -->
            <div v-if="editingId === category.id" class="category-item__edit">
              <div class="edit-row">
                <IconPicker
                  :model-value="editingForm.icon"
                  mode="popover"
                  @update:model-value="editingForm.icon = $event"
                />
                <BaseInput
                  v-model="editingForm.name"
                  placeholder="分类名称"
                  class="category-input"
                  auto-focus
                  @keyup.enter="handleUpdateCategory"
                />
                <div class="action-buttons">
                  <button class="action-btn save-btn" title="保存" @click="handleUpdateCategory">
                    <i class="fas fa-check" />
                  </button>
                  <button class="action-btn cancel-btn" title="取消" @click="cancelEdit">
                    <i class="fas fa-times" />
                  </button>
                </div>
              </div>
            </div>

            <!-- View Mode -->
            <div v-else class="category-item__content">
              <label class="selection-checkbox" @click.stop>
                <input
                  type="checkbox"
                  :checked="selectedIds.includes(category.id)"
                  @change="toggleSelection(category.id)"
                />
              </label>
              <div class="category-item__drag-handle">
                <i class="fas fa-grip-vertical" />
              </div>
              <div class="category-item__icon">
                <i :class="category.icon || 'fas fa-folder'" />
              </div>
              <div class="category-item__info">
                <span class="category-item__name">{{ category.name }}</span>
                <span class="category-item__count">{{ getCategoryCount(category.id) }}</span>
              </div>
              <div class="category-item__actions">
                <button class="action-btn edit-btn" title="编辑" @click="startEdit(category)">
                  <i class="fas fa-pencil-alt" />
                </button>
                <button class="action-btn delete-btn" title="删除" @click="confirmDelete(category)">
                  <i class="fas fa-trash-alt" />
                </button>
              </div>
            </div>
          </div>
        </TransitionGroup>
      </div>

      <!-- Add Category Button (Bottom) -->
      <div class="add-category-section">
        <button v-if="!isAdding" class="add-category-btn" @click="isAdding = true">
          <i class="fas fa-plus" />
          <span>添加分类</span>
        </button>

        <div v-else class="add-category-form">
          <div class="form-row">
            <IconPicker v-model="newCategoryIcon" mode="popover" />
            <BaseInput
              v-model="newCategoryName"
              placeholder="分类名称"
              class="category-input"
              auto-focus
              @keyup.enter="handleAddCategory"
            />
            <div class="form-actions">
              <BaseButton
                variant="primary"
                size="sm"
                :disabled="!newCategoryName.trim()"
                @click="handleAddCategory"
              >
                确定
              </BaseButton>
              <BaseButton variant="ghost" size="sm" @click="cancelAdd">取消</BaseButton>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Delete Confirmation -->
    <BaseModal
      :is-open="showDeleteModal"
      :title="categoryToDelete ? '删除分类' : '批量删除分类'"
      size="sm"
      @close="showDeleteModal = false"
    >
      <p class="delete-confirm-text">
        {{
          categoryToDelete
            ? `确定要删除分类“${categoryToDelete.name}”吗？`
            : `确定要删除选中的 ${selectedIds.length} 个分类吗？`
        }}
        <br />
        <span class="text-danger">该分类下的网站将被移至“未分类”。</span>
      </p>
      <template #footer>
        <div class="modal-footer-actions">
          <BaseButton variant="ghost" @click="showDeleteModal = false">取消</BaseButton>
          <BaseButton variant="danger" :loading="deleting" @click="handleDeleteCategory">
            删除
          </BaseButton>
        </div>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useCategoryStore } from '@/stores/category'
import { useWebsiteStore } from '@/stores/website'
import { useUIStore } from '@/stores/ui'
import { BaseInput, BaseButton, BaseModal, IconPicker, EmptyState } from '@nav/ui'
import type { Category } from '@/types'
import { computeReorderedIds } from '@/utils/helpers'

const categoryStore = useCategoryStore()
const websiteStore = useWebsiteStore()
const uiStore = useUIStore()

const categories = computed(() => categoryStore.categories)
const isAdding = ref(false)
const newCategoryName = ref('')
const newCategoryIcon = ref('fas fa-folder')

const showDeleteModal = ref(false)
const categoryToDelete = ref<Category | null>(null)
const selectedIds = ref<string[]>([])
const deleting = ref(false)
const allSelected = computed(
  () =>
    categories.value.length > 0 &&
    categories.value.every(item => selectedIds.value.includes(item.id))
)

const editingId = ref<string | null>(null)
const editingForm = ref({
  name: '',
  icon: ''
})

const getCategoryCount = (id: string) => {
  return websiteStore.websites.filter(w => w.categoryId === id).length
}

const handleAddCategory = async () => {
  if (!newCategoryName.value.trim()) return
  try {
    await categoryStore.addCategory({
      name: newCategoryName.value.trim(),
      icon: newCategoryIcon.value
    })
    newCategoryName.value = ''
    newCategoryIcon.value = 'fas fa-folder'
    isAdding.value = false
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '添加分类失败', 'error')
  }
}

const cancelAdd = () => {
  isAdding.value = false
  newCategoryName.value = ''
  newCategoryIcon.value = 'fas fa-folder'
}

const startEdit = (category: Category) => {
  editingId.value = category.id
  editingForm.value = {
    name: category.name,
    icon: category.icon || 'fas fa-folder'
  }
}

const cancelEdit = () => {
  editingId.value = null
  editingForm.value = { name: '', icon: '' }
}

const handleUpdateCategory = async () => {
  if (!editingId.value || !editingForm.value.name.trim()) return
  try {
    await categoryStore.updateCategory(editingId.value, {
      name: editingForm.value.name,
      icon: editingForm.value.icon
    })
    editingId.value = null
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '更新分类失败', 'error')
  }
}

const confirmDelete = (category: Category) => {
  categoryToDelete.value = category
  showDeleteModal.value = true
}

const toggleSelection = (id: string) => {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter(selectedId => selectedId !== id)
    : [...selectedIds.value, id]
}

const toggleSelectAll = () => {
  selectedIds.value = allSelected.value ? [] : categories.value.map(category => category.id)
}

const confirmBulkDelete = () => {
  if (selectedIds.value.length === 0) return
  categoryToDelete.value = null
  showDeleteModal.value = true
}

const handleDeleteCategory = async () => {
  if (deleting.value) return
  const ids = categoryToDelete.value ? [categoryToDelete.value.id] : selectedIds.value
  if (ids.length === 0) return
  deleting.value = true
  try {
    if (categoryToDelete.value) {
      await categoryStore.deleteCategory(categoryToDelete.value.id)
    } else {
      await categoryStore.bulkDeleteCategories(ids)
    }
    await websiteStore.initializeData()
    selectedIds.value = selectedIds.value.filter(id => !ids.includes(id))
    showDeleteModal.value = false
    categoryToDelete.value = null
    uiStore.showToast(ids.length > 1 ? `已删除 ${ids.length} 个分类` : '分类删除成功', 'success')
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '删除分类失败', 'error')
  } finally {
    deleting.value = false
  }
}

// Drag and Drop Logic
const draggedItem = ref<Category | null>(null)

const onDragStart = (e: DragEvent, category: Category) => {
  draggedItem.value = category
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.dropEffect = 'move'
  }
  if (e.target) {
    ;(e.target as HTMLElement).classList.add('is-dragging')
  }
}

const onDragEnd = (e: DragEvent) => {
  draggedItem.value = null
  if (e.target) {
    ;(e.target as HTMLElement).classList.remove('is-dragging')
  }
}

const onDragOver = (e: DragEvent) => {
  e.preventDefault()
}

const onDrop = (e: DragEvent, targetCategory: Category) => {
  e.preventDefault()
  if (!draggedItem.value || draggedItem.value.id === targetCategory.id) return

  const orderIds = categories.value.map(c => c.id)
  const nextIds = computeReorderedIds(orderIds, draggedItem.value.id, targetCategory.id)
  void categoryStore.reorderCategories(nextIds).catch(error => {
    uiStore.showToast(error instanceof Error ? error.message : '分类排序失败', 'error')
  })
}
</script>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.manage-categories-modal {
  padding: 0;
}

.modal-content-wrapper {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.category-list-container {
  max-height: 400px;
  overflow-y: auto;
  padding: 4px;
}

.bulk-management {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  color: var(--text-secondary);
  font-size: 13px;
}

.select-all,
.selection-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.category-item {
  background-color: var(--bg-panel);
  border: 1px solid var(--border-tile);
  border-radius: 12px;
  padding: 12px 16px;
  transition:
    background-color 0.2s,
    box-shadow 0.2s,
    transform 0.2s;
  cursor: grab;

  &:hover {
    border-color: var(--border-tile-hover);
    box-shadow: var(--shadow-sm);
    transform: translateY(-1px);

    .category-item__drag-handle {
      color: var(--text-secondary);
    }
  }

  &.is-dragging {
    opacity: 0.5;
    background-color: var(--bg-tile);
  }

  &.is-editing {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
    cursor: default;
  }
}

.category-item__content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.category-item__drag-handle {
  color: var(--border-tile);
  cursor: grab;
  padding: 4px;
  transition: color 0.2s;
}

.category-item__icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background-color: var(--bg-tile);
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}

.category-item__info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.category-item__name {
  font-weight: 600;
  color: var(--text-main);
  font-size: 15px;
  flex: 1;
}

.category-item__count {
  background-color: var(--bg-tile);
  color: var(--text-secondary);
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 500;
}

.category-item__actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;

  .category-item:hover & {
    opacity: 1;
  }
}

.action-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background-color: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;

  &:hover {
    background-color: var(--bg-tile);
    color: var(--text-main);
  }

  &.delete-btn:hover {
    background-color: rgba(239, 68, 68, 0.1);
    color: var(--color-error);
  }

  &.save-btn {
    color: var(--color-success);
    &:hover {
      background-color: rgba(16, 185, 129, 0.1);
    }
  }

  &.cancel-btn:hover {
    color: var(--text-main);
  }
}

.add-category-section {
  margin-top: 8px;
}

.add-category-btn {
  width: 100%;
  padding: 12px;
  border: 1px dashed var(--border-tile);
  border-radius: 12px;
  background-color: transparent;
  color: var(--color-primary);
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.2s;
  border-color: var(--color-primary);

  &:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
    background-color: rgba(37, 99, 235, 0.02);
  }
}

.add-category-form {
  background-color: var(--bg-tile);
  border-radius: 12px;
  padding: 12px;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.category-input {
  flex: 1;
}

.form-actions {
  display: flex;
  gap: 8px;
}

.delete-confirm-text {
  color: var(--text-main);
  font-size: 15px;
  line-height: 1.6;
}

.text-danger {
  color: var(--color-error);
  font-size: 13px;
}

.modal-footer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  width: 100%;
}

.edit-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.action-buttons {
  display: flex;
  gap: 4px;
}

/* List Transitions */
.list-move,
.list-enter-active,
.list-leave-active {
  transition: all 0.3s ease;
}

.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

.list-leave-active {
  position: absolute;
}
</style>
