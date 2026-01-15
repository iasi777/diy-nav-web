/**
 * 无限滚动 Composable
 * 滚动到底部时自动加载更多数据
 */

import { ref, computed, onMounted, onUnmounted, type Ref } from 'vue'

interface InfiniteScrollOptions {
  /** 每次加载数量 */
  pageSize?: number
  /** 初始加载数量 */
  initialSize?: number
  /** 触发加载的距离（距离底部多少像素时触发） */
  threshold?: number
}

export function useInfiniteScroll<T>(items: Ref<T[]>, options: InfiniteScrollOptions = {}) {
  const { pageSize = 30, initialSize = 30, threshold = 200 } = options

  const loadedCount = ref(initialSize)
  const isLoading = ref(false)

  // 当前显示的数据
  const visibleItems = computed(() => {
    return items.value.slice(0, loadedCount.value)
  })

  // 是否还有更多数据
  const hasMore = computed(() => {
    return loadedCount.value < items.value.length
  })

  // 加载进度
  const progress = computed(() => {
    if (items.value.length === 0) return 100
    return Math.round((loadedCount.value / items.value.length) * 100)
  })

  // 加载更多
  const loadMore = () => {
    if (isLoading.value || !hasMore.value) return

    isLoading.value = true

    // 使用 requestAnimationFrame 避免阻塞
    requestAnimationFrame(() => {
      loadedCount.value = Math.min(loadedCount.value + pageSize, items.value.length)
      isLoading.value = false
    })
  }

  // 重置（数据源变化时调用）
  const reset = () => {
    loadedCount.value = initialSize
  }

  // 滚动事件处理
  const handleScroll = () => {
    if (!hasMore.value || isLoading.value) return

    const scrollTop = window.scrollY || document.documentElement.scrollTop
    const scrollHeight = document.documentElement.scrollHeight
    const clientHeight = window.innerHeight

    // 距离底部小于 threshold 时加载更多
    if (scrollHeight - scrollTop - clientHeight < threshold) {
      loadMore()
    }
  }

  // 节流处理
  let ticking = false
  const throttledScroll = () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        handleScroll()
        ticking = false
      })
      ticking = true
    }
  }

  // 生命周期
  onMounted(() => {
    window.addEventListener('scroll', throttledScroll, { passive: true })
  })

  onUnmounted(() => {
    window.removeEventListener('scroll', throttledScroll)
  })

  return {
    // 状态
    visibleItems,
    hasMore,
    isLoading,
    progress,
    loadedCount,
    totalCount: computed(() => items.value.length),

    // 方法
    loadMore,
    reset
  }
}
