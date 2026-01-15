<template>
  <div class="empty-state" :class="[`size-${size}`]">
    <div class="empty-icon-wrapper">
      <slot name="icon">
        <div class="default-icon-bg">
          <i class="fas fa-inbox" />
        </div>
      </slot>
    </div>
    <div class="empty-content">
      <h3 class="empty-title">{{ message }}</h3>
      <p v-if="description" class="empty-desc">{{ description }}</p>
      <div v-if="showActionButton" class="empty-actions">
        <slot name="action" />
      </div>
      <p v-if="hint" class="empty-hint">{{ hint }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

export interface Props {
  type?: 'default' | 'no-data' | 'no-results' | 'no-websites' | 'no-tags' | 'no-categories'
  message?: string
  description?: string
  hint?: string
  showActionButton?: boolean
  size?: 'default' | 'small'
}

const props = withDefaults(defineProps<Props>(), {
  type: 'default',
  message: '',
  description: '',
  hint: '',
  showActionButton: false,
  size: 'default'
})

const hint = computed(() => props.hint ?? '')
const message = computed(() => {
  if (props.message) return props.message
  const t = (props.type || '').toLowerCase()
  if (t.includes('no-tags')) return '暂无标签'
  if (t.includes('no-categories')) return '暂无分类'
  if (t.includes('no-websites')) return '暂无网站'
  return '暂无数据'
})
</script>

<style scoped lang="scss">
@use '../styles/variables.scss' as *;

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: $spacing-2xl;
  padding: $spacing-2xl * 2 $spacing-2xl;
  color: $color-neutral-600;
  text-align: center;
  max-width: 600px;
  margin: 0 auto;

  &.size-small {
    gap: $spacing-xl;
    padding: $spacing-2xl $spacing-xl;

    .default-icon-bg {
      width: 80px;
      height: 80px;
      border-radius: $border-radius-2xl;
      font-size: 32px;

      &::after {
        border-radius: $border-radius-lg;
      }
    }

    .empty-title {
      font-size: $font-size-lg;
    }

    .empty-desc {
      font-size: $font-size-sm;
    }
  }
}

.empty-icon-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
}

.default-icon-bg {
  width: 120px;
  height: 120px;
  border-radius: 40px;
  background: linear-gradient(135deg, #e0e7ff 0%, $color-neutral-100 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48px;
  color: #818cf8;
  box-shadow: $shadow-lg;
  position: relative;

  &::after {
    content: '';
    position: absolute;
    width: 80%;
    height: 80%;
    background: rgba($color-white, 0.5);
    border-radius: 30px;
    top: 50%;
    left: 50%;
    transform: translate(-30%, -30%);
  }

  i {
    position: relative;
    z-index: 1;
  }
}

.empty-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $spacing-xl;
}

.empty-title {
  font-size: $font-size-xl;
  font-weight: $font-weight-bold;
  color: $color-neutral-800;
  margin: 0;
}

.empty-desc {
  font-size: $font-size-base;
  color: $color-neutral-600;
  line-height: $line-height-relaxed;
  max-width: 480px;
  margin: 0;
}

.empty-actions {
  margin-top: $spacing-xl;
  margin-bottom: $spacing-xl;
}

.empty-hint {
  font-size: $font-size-sm;
  color: $color-neutral-500;
  margin-top: $spacing-xl;
}
</style>
