/**
 * @nav/config - Schema Definitions
 * 所有环境变量的 Zod schema 定义（Single Source of Truth）
 */
import { z } from 'zod'

// ============================================
// Server 配置
// ============================================
export const serverSchema = z.object({
  PORT: z.coerce.number().default(8787),
  APP_PORT: z.coerce.number().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_NAME: z.string().default('diy-nav-web')
})

export const localDatabaseSchema = z.object({
  DATABASE_PATH: z.string().trim().min(1).default('./data/diy-nav.sqlite'),
  BACKUP_DIR: z.string().trim().min(1).default('./backups')
})

const optionalText = z.preprocess(
  value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional()
)

export const aiGatewaySchema = z.object({
  AI_NEW_API_BASE_URL: z.preprocess(
    value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().url().optional()
  ),
  AI_NEW_API_KEY: optionalText,
  AI_DEFAULT_MODEL: optionalText
})

// ============================================
// Log 配置
// ============================================
export const logSchema = z.object({
  LOG_LEVEL: z.string().optional(),
  LOG_HEADERS: z
    .string()
    .transform(val => val === 'true')
    .default('false')
})

// ============================================
// 完整配置 Schema（合并所有子 schema）
// ============================================
export const configSchema = z
  .object({})
  .merge(serverSchema)
  .merge(localDatabaseSchema)
  .merge(aiGatewaySchema)
  .merge(logSchema)
  .superRefine((data, ctx) => {
    if (Boolean(data.AI_NEW_API_BASE_URL) !== Boolean(data.AI_NEW_API_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AI_NEW_API_KEY'],
        message: 'AI_NEW_API_BASE_URL and AI_NEW_API_KEY must be configured together'
      })
    }
  })

// 导出原始配置类型
export type RawConfig = z.infer<typeof configSchema>
