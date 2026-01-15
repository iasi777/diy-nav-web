<template>
  <AuthLayout>
    <div v-if="!errorState" class="state-loading">
      <!-- Branded Logo (Pulsing) -->
      <div class="logo-wrapper">
        <BrandLogo :pulsing="true" />
      </div>

      <h2 class="status-title">正在验证身份...</h2>
      <p class="status-desc">请稍候，我们正在建立安全连接</p>

      <!-- Progress Bar -->
      <div class="progress-bar">
        <div class="progress-inner" />
      </div>
    </div>

    <!-- Error State -->
    <div v-else class="state-error">
      <div class="error-icon-wrapper">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="error-icon"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </div>
      <h2 class="status-title text-error">验证失败</h2>
      <p class="status-desc">{{ errorState }}</p>
      <button class="btn-retry" @click="retryLogin">返回登录页</button>
    </div>
  </AuthLayout>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'
import { AuthLayout, BrandLogo } from '@nav/ui'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const uiStore = useUIStore()

const errorState = ref<string | null>(null)

onMounted(async () => {
  const code = route.query.code as string
  const state = route.query.state as string
  const storedState = localStorage.getItem('oauth_state')
  const storedProvider = localStorage.getItem('oauth_provider') || 'linuxdo'

  // Artificial delay for smoother UX
  await new Promise(resolve => setTimeout(resolve, 800))

  // Security: Validate CSRF State
  if (!state || state !== storedState) {
    errorState.value = '安全校验失败 (CSRF): 请求来源不可信'
    return
  }

  localStorage.removeItem('oauth_state')
  localStorage.removeItem('oauth_provider')

  if (!code) {
    errorState.value = '授权回调异常: 未能获取授权码'
    return
  }

  try {
    await authStore.loginWithProvider(storedProvider, code)

    uiStore.showToast('欢迎回来', 'success')
    router.replace('/')
  } catch (error: unknown) {
    const err = error as Error
    console.error('OAuth Error:', err)
    errorState.value = err.message || '登录验证失败，请重试'
  }
})

const retryLogin = () => {
  router.replace('/login')
}
</script>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.logo-wrapper {
  margin-bottom: var(--spacing-2xl);
}

/* Error State Styles */
.state-loading,
.state-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.error-icon-wrapper {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba($color-error, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--spacing-2xl);
}

.error-icon {
  width: 32px;
  height: 32px;
  color: var(--color-error);
}

.text-error {
  color: var(--color-error);
}

.btn-retry {
  margin-top: var(--spacing-md);
  padding: var(--spacing-md) var(--spacing-2xl);
  background: var(--color-white);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  color: var(--color-neutral-700);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-retry:hover {
  background: var(--color-neutral-50);
  border-color: var(--color-neutral-300);
  color: var(--color-neutral-900);
}

.status-title {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  color: var(--text-main);
  margin-bottom: var(--spacing-md);
}

.status-desc {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  margin-bottom: var(--spacing-2xl);
}

.progress-bar {
  width: 100%;
  height: var(--spacing-sm);
  background: var(--color-neutral-100);
  border-radius: var(--radius-pill);
  overflow: hidden;
}

.progress-inner {
  height: 100%;
  background: var(--color-primary);
  width: 30%;
  border-radius: var(--radius-pill);
  animation: progress 1.5s ease-in-out infinite;
}

@keyframes progress {
  0% {
    transform: translateX(-100%);
  }
  50% {
    transform: translateX(100%);
    width: 60%;
  }
  100% {
    transform: translateX(200%);
  }
}

/* Dark mode support */
:global([data-theme='dark']) {
  .error-icon-wrapper {
    background: rgba($color-error, 0.15);
  }
  .status-title {
    color: var(--text-main);
  }
  .status-desc {
    color: var(--text-secondary);
  }
  .progress-bar {
    background: var(--color-neutral-700);
  }
}
</style>
