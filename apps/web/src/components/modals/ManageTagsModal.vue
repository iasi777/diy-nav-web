<template>
  <div class="manage-tags-modal">
    <div class="modal-content-wrapper">
      <!-- 标签列表 -->
      <div class="tag-list-container">
        <div v-if="tags.length > 0" class="bulk-management">
          <label class="select-all">
            <input type="checkbox" :checked="allSelected" @change="toggleSelectAll" />
            全选
          </label>
          <span>已选 {{ selectedIds.length }} 项</span>
          <BaseButton
            variant="danger"
            size="sm"
            :disabled="selectedIds.length === 0"
            @click="openBulkDeleteConfirm"
          >
            批量删除
          </BaseButton>
        </div>

        <!-- 空状态 -->
        <EmptyState
          v-if="tags.length === 0"
          type="no-tags"
          :show-action-button="false"
          size="small"
        />

        <!-- 标签列表 -->
        <TransitionGroup v-else name="list" tag="div" class="tag-list">
          <TagListItem
            v-for="tag in sortedTags"
            :key="tag.id"
            :tag="tag"
            :editing="editingId === tag.id"
            :usage-count="getWebsiteCount(tag.id)"
            :updating="updating"
            selectable
            :selected="selectedIds.includes(tag.id)"
            @select="toggleSelection(tag.id)"
            @edit="startEdit(tag)"
            @delete="handleDeleteTag(tag)"
            @save="handleSave"
            @cancel="cancelEdit"
            @dragstart="onDragStart"
            @drop="onDrop"
          />
        </TransitionGroup>
      </div>

      <!-- 添加新标签 (Bottom) -->
      <div class="add-tag-section">
        <button v-if="!adding" class="add-tag-btn" @click="adding = true">
          <i class="fas fa-plus" />
          <span>添加标签</span>
        </button>

        <div v-else class="add-tag-form">
          <div class="form-row">
            <BaseInput
              ref="tagNameInputRef"
              v-model="newTag.name"
              placeholder="标签名称"
              class="tag-input"
              required
              :maxlength="15"
              @keyup.enter="handleAddTag"
            />
            <ColorPicker v-model="newTag.color" />
            <div class="form-actions">
              <BaseButton
                variant="primary"
                size="sm"
                :loading="submitting"
                :disabled="!newTag.name.trim() || !newTag.color"
                @click="handleAddTag"
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
      :is-open="deleteConfirmOpen"
      :title="deleteTargetId ? '删除标签' : '批量删除标签'"
      size="sm"
      @close="closeDeleteConfirm"
    >
      <p class="delete-confirm-text">
        {{
          deleteTargetId
            ? `确定要删除标签“${tags.find(t => t.id === deleteTargetId)?.name}”吗？`
            : `确定要删除选中的 ${selectedIds.length} 个标签吗？`
        }}
        <br />
        <span class="text-danger">网站会保留，仅解除这些标签关联。此操作不可恢复。</span>
      </p>
      <template #footer>
        <div class="modal-footer-actions">
          <BaseButton variant="ghost" @click="closeDeleteConfirm">取消</BaseButton>
          <BaseButton variant="danger" :loading="deleting" @click="confirmDeleteTag">
            删除
          </BaseButton>
        </div>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { useTagStore } from '@/stores/tag'
import { useWebsiteStore } from '@/stores/website'
import { useUIStore } from '@/stores/ui'
import { BaseInput, BaseButton, BaseModal, EmptyState, ColorPicker } from '@nav/ui'
import type { Tag } from '@/types'
import { ERROR_DUPLICATE_NAME } from '@/types'
import { computeReorderedIds } from '@/utils/helpers'
import TagListItem from './parts/TagListItem.vue'

// Store
const tagStore = useTagStore()
const websiteStore = useWebsiteStore()
const uiStore = useUIStore()

const tagNameInputRef = ref()

const newTag = ref({
  name: '',
  color: '#3B82F6'
})

const editingId = ref<string | null>(null)

const adding = ref(false)
const submitting = ref(false)
const updating = ref(false)

// 计算属性
const tags = computed(() => tagStore.tags)
const selectedIds = ref<string[]>([])
const allSelected = computed(
  () => tags.value.length > 0 && tags.value.every(tag => selectedIds.value.includes(tag.id))
)

const sortedTags = computed(() => {
  return [...tags.value].sort((a, b) => a.order - b.order)
})

const draggingId = ref<string | null>(null)
const onDragStart = (id: string) => {
  draggingId.value = id
}
const onDrop = (targetId: string) => {
  if (!draggingId.value) return
  const orderIds = sortedTags.value.map(t => t.id)
  const nextIds = computeReorderedIds(orderIds, draggingId.value, targetId)
  void tagStore.reorderTags(nextIds).catch(() => {
    uiStore.showToast('标签排序失败', 'error')
  })
  draggingId.value = null
}

// 获取标签下的网站数量
const getWebsiteCount = (tagId: string): number => {
  return websiteStore.websites.filter(w => w.tagIds.includes(tagId)).length
}

// 处理添加标签
const handleAddTag = async () => {
  if (!newTag.value.name.trim() || !newTag.value.color || submitting.value) {
    return
  }

  submitting.value = true

  try {
    const exists = tags.value.some(
      t => t.name.toLowerCase() === newTag.value.name.trim().toLowerCase()
    )
    if (exists) {
      uiStore.showToast('标签名称已存在', 'warning')
      return
    }
    await tagStore.addTag({
      name: newTag.value.name.trim(),
      color: newTag.value.color
    })

    uiStore.showToast('标签添加成功', 'success')

    // 重置表单
    newTag.value = { name: '', color: '#3B82F6' }
    adding.value = false
  } catch (error) {
    if (error instanceof Error && error.message === ERROR_DUPLICATE_NAME) {
      uiStore.showToast('标签名称已存在', 'warning')
    } else {
      uiStore.showToast('添加失败，请重试', 'error')
    }
  } finally {
    submitting.value = false
  }
}

const cancelAdd = () => {
  adding.value = false
  newTag.value = { name: '', color: '#3B82F6' }
}

// Watch adding state to focus input
watch(adding, val => {
  if (val) {
    nextTick(() => {
      tagNameInputRef.value?.focus()
    })
  }
})

// 开始编辑
const startEdit = (tag: Tag) => {
  editingId.value = tag.id
}

// 处理更新标签
const handleSave = async (payload: { name: string; color: string }) => {
  if (!editingId.value || updating.value) return
  const name = payload.name.trim()
  const color = payload.color
  if (!name || !color) return
  const exists = tags.value.some(
    t => t.id !== editingId.value && t.name.toLowerCase() === name.toLowerCase()
  )
  if (exists) {
    uiStore.showToast('标签名称已存在', 'warning')
    return
  }

  updating.value = true
  try {
    await tagStore.updateTag(editingId.value, { name, color })
    uiStore.showToast('标签更新成功', 'success')
    cancelEdit()
  } catch (error) {
    if (error instanceof Error && error.message === ERROR_DUPLICATE_NAME) {
      uiStore.showToast('标签名称已存在', 'warning')
    } else {
      uiStore.showToast('更新失败，请重试', 'error')
    }
  } finally {
    updating.value = false
  }
}

// 取消编辑
const cancelEdit = () => {
  editingId.value = null
}

// 处理删除标签
const handleDeleteTag = (tag: Tag) => {
  deleteTargetId.value = tag.id
  deleteConfirmOpen.value = true
}

const deleteConfirmOpen = ref(false)
const deleteTargetId = ref<string>('')
const deleting = ref(false)

const closeDeleteConfirm = () => {
  deleteConfirmOpen.value = false
  deleteTargetId.value = ''
}

const toggleSelection = (id: string) => {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter(selectedId => selectedId !== id)
    : [...selectedIds.value, id]
}

const toggleSelectAll = () => {
  selectedIds.value = allSelected.value ? [] : sortedTags.value.map(tag => tag.id)
}

const openBulkDeleteConfirm = () => {
  if (selectedIds.value.length === 0) return
  deleteTargetId.value = ''
  deleteConfirmOpen.value = true
}

const confirmDeleteTag = async () => {
  if (deleting.value) return
  const ids = deleteTargetId.value ? [deleteTargetId.value] : selectedIds.value
  if (ids.length === 0) return
  deleting.value = true
  try {
    if (deleteTargetId.value) await tagStore.deleteTag(deleteTargetId.value)
    else await tagStore.bulkDeleteTags(ids)
    await websiteStore.initializeData()
    selectedIds.value = selectedIds.value.filter(id => !ids.includes(id))
    uiStore.showToast(ids.length > 1 ? `已删除 ${ids.length} 个标签` : '标签删除成功', 'success')
    closeDeleteConfirm()
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '删除失败，请重试', 'error')
  } finally {
    deleting.value = false
  }
}
</script>

<style scoped lang="scss">
@use '@/styles/variables' as *;
@use '@/styles/mixins' as *;

.manage-tags-modal {
  padding: 0;
}

.modal-content-wrapper {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.tag-list-container {
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

.select-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.tag-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.add-tag-section {
  margin-top: 8px;
}

.add-tag-btn {
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

.add-tag-form {
  background-color: var(--bg-tile);
  border-radius: 12px;
  padding: 12px;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.tag-input {
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
