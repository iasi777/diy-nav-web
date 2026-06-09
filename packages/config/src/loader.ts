/**
 * @nav/config - Config Loader
 * 统一的 .env 加载和验证逻辑
 */
import dotenv from 'dotenv'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { configSchema, type RawConfig } from './schema.js'

// 配置缓存
let configCache: RawConfig | null = null

/**
 * 加载 .env 文件
 * 支持多环境文件优先级：.env.local > .env.{NODE_ENV} > .env
 */
function loadEnvFiles(): void {
  const cwd = process.cwd()
  const nodeEnv = process.env.NODE_ENV || 'development'

  // 可能的 .env 文件路径（按优先级排序，后加载的会覆盖先加载的）
  const envPaths = [
    '.env', // 基础配置
    `.env.${nodeEnv}`, // 环境特定配置
    '.env.local', // 本地覆盖（不提交到 git）
    // Monorepo 根目录
    '../../.env',
    `../../.env.${nodeEnv}`,
    '../../.env.local'
  ]

  for (const envPath of envPaths) {
    const fullPath = resolve(cwd, envPath)
    if (existsSync(fullPath)) {
      dotenv.config({ path: fullPath })
    }
  }
}

/**
 * 加载并验证配置
 * @param forceReload 是否强制重新加载（忽略缓存）
 */
export function loadRawConfig(forceReload = false): RawConfig {
  if (configCache && !forceReload) {
    return configCache
  }

  // 加载 .env 文件
  loadEnvFiles()

  // 处理 APP_PORT -> PORT 兼容
  if (process.env.APP_PORT && !process.env.PORT) {
    process.env.PORT = process.env.APP_PORT
  }

  // 验证配置
  const result = configSchema.safeParse(process.env)

  if (!result.success) {
    // eslint-disable-next-line no-console
    console.error('❌ Invalid environment variables:')
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(result.error.format(), null, 2))
    throw new Error('Invalid environment variables')
  }

  const config = result.data

  configCache = config
  return config
}

/**
 * 获取结构化配置对象
 */
export function getConfig() {
  const raw = loadRawConfig()

  return {
    server: {
      port: raw.PORT,
      env: raw.NODE_ENV,
      appName: raw.APP_NAME
    },
    localDatabase: {
      path: raw.DATABASE_PATH,
      backupDir: raw.BACKUP_DIR
    },
    aiGateway: {
      baseUrl: raw.AI_NEW_API_BASE_URL,
      apiKey: raw.AI_NEW_API_KEY,
      defaultModel: raw.AI_DEFAULT_MODEL
    },
    log: {
      level: raw.LOG_LEVEL,
      headers: raw.LOG_HEADERS
    }
  }
}

// 导出配置类型
export type Config = ReturnType<typeof getConfig>
