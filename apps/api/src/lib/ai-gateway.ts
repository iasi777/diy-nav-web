import { z } from 'zod'
import { config } from '@nav/config'
import { logger } from '@nav/logger'

const taxonomySchema = z.object({
  categories: z
    .array(
      z.object({
        name: z.string().min(1).max(40).refine(containsChinese, 'Category name must be Chinese'),
        description: z
          .string()
          .max(120)
          .refine(containsChinese, 'Category description must be Chinese')
          .optional()
      })
    )
    .min(1)
    .max(20)
})

const taxonomyArraySchema = taxonomySchema.shape.categories
const taxonomyPayloadSchema = z
  .union([taxonomySchema, taxonomyArraySchema])
  .transform(payload => (Array.isArray(payload) ? payload : payload.categories))

const classificationItemsSchema = z.array(
  z.object({
    itemId: z.string(),
    category: z.string().min(1).max(40),
    tags: z.array(z.string().min(1).max(30)).length(1),
    description: z
      .string()
      .min(1)
      .max(160)
      .refine(containsChinese, 'Bookmark description must be Chinese')
  })
)
const classificationPayloadSchema = z
  .union([z.object({ items: classificationItemsSchema }), classificationItemsSchema])
  .transform(payload => (Array.isArray(payload) ? payload : payload.items))

export type Taxonomy = z.infer<typeof taxonomySchema>['categories']
export type ClassificationResult = z.infer<typeof classificationItemsSchema>[number]
export interface ExistingCategory {
  name: string
  description?: string
  usageCount: number
}
export interface AiClient {
  isConfigured(): boolean
  listModels(): Promise<string[]>
  proposeTaxonomy(
    model: string,
    bookmarks: Array<{ title: string; url: string; folderPath: string }>,
    existingCategories: ExistingCategory[]
  ): Promise<Taxonomy>
  classifyBookmarks(
    model: string,
    taxonomy: Taxonomy,
    bookmarks: Array<{ itemId: string; title: string; url: string; folderPath: string }>,
    tagVocabulary: string[]
  ): Promise<ClassificationResult[]>
}

interface RetryOptions {
  maxRetries?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
  sleep?: (delayMs: number) => Promise<void>
  onRetry?: (event: { attempt: number; delayMs: number; status?: number; error?: unknown }) => void
}

export class AiGatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'AiGatewayError'
  }
}

interface ModelListResponse {
  data?: Array<{ id?: string }>
}

interface CompletionResponse {
  choices?: Array<{
    finish_reason?: string
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
    }
  }>
}

export function isAiConfigured(): boolean {
  return Boolean(config.aiGateway.baseUrl && config.aiGateway.apiKey)
}

export async function listAiModels(): Promise<string[]> {
  const response = await gatewayFetch('/models', { method: 'GET' })
  const payload = (await response.json()) as ModelListResponse
  return (payload.data ?? [])
    .map(model => model.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .sort()
}

export async function proposeTaxonomy(
  model: string,
  bookmarks: Array<{ title: string; url: string; folderPath: string }>,
  existingCategories: ExistingCategory[]
): Promise<Taxonomy> {
  const sample = bookmarks.slice(0, 300)
  const categoryRange = recommendedCategoryRange(sample.length)
  return completeJson(
    model,
    {
      name: 'bookmark_taxonomy',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['categories'],
        properties: {
          categories: {
            type: 'array',
            minItems: categoryRange.min,
            maxItems: categoryRange.max,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name'],
              properties: {
                name: { type: 'string' },
                description: { type: 'string' }
              }
            }
          }
        }
      },
      system: `你负责整理中文个人书签。只输出符合 JSON schema 的 JSON，不要输出解释、标题或 Markdown。根据这批 ${sample.length} 条书签生成最多 ${categoryRange.max} 个宽泛、稳定、互不重叠的分类。逐项对比已有分类，语义相近时必须复用已有名称，仅在没有合理匹配时新增。优先合并相近主题，禁止一个网站单独一个分类，禁止为了凑数量拆分相近分类或生成无关分类。分类名称和说明必须使用简体中文，即使网页标题是英文。无法明确归类的内容可统一放入“其他”或“待整理”。`,
      user: JSON.stringify({ existingCategories, bookmarks: sample })
    },
    parseTaxonomyPayload
  )
}

export async function classifyBookmarks(
  model: string,
  taxonomy: Taxonomy,
  bookmarks: Array<{ itemId: string; title: string; url: string; folderPath: string }>,
  tagVocabulary: string[]
): Promise<ClassificationResult[]> {
  const allowed = taxonomy.map(item => item.name)
  return completeJson(
    model,
    {
      name: 'bookmark_classification',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['items'],
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['itemId', 'category', 'tags', 'description'],
              properties: {
                itemId: { type: 'string' },
                category: { type: 'string' },
                tags: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 1,
                  items: { type: 'string' }
                },
                description: { type: 'string', maxLength: 160 }
              }
            }
          }
        }
      },
      system:
        '你负责整理中文个人书签。只输出符合 JSON schema 的 JSON，不要输出解释、标题或 Markdown。每条书签必须且只能分类一次，只能使用给定分类名称。每条书签恰好生成 1 个简短中文标签。逐项对比已有标签词表，语义相近时必须使用已有名称，仅在没有合理匹配时新增。相同或相近主题必须复用同一标签，合并同义词，禁止为每个网站创造专属标签。为每条书签写一句简体中文事实描述；即使标题或网站是英文，description 也必须是简体中文。不要访问网页。',
      user: JSON.stringify({ taxonomy, tagVocabulary, bookmarks })
    },
    content => {
      const parsed = parseClassificationPayload(content)
      const requestedIds = new Set(bookmarks.map(item => item.itemId))
      const returnedIds = new Set(parsed.map(item => item.itemId))
      const canonicalCategories = new Map(allowed.map(name => [normalizeVocabularyKey(name), name]))
      const canonicalTags = new Map(tagVocabulary.map(name => [normalizeVocabularyKey(name), name]))
      if (
        parsed.length !== requestedIds.size ||
        returnedIds.size !== requestedIds.size ||
        parsed.some(
          item =>
            !requestedIds.has(item.itemId) ||
            !canonicalCategories.has(normalizeVocabularyKey(item.category))
        )
      ) {
        throw new Error('AI response did not classify exactly the requested bookmark set')
      }
      return parsed.map(item => ({
        ...item,
        category:
          canonicalCategories.get(normalizeVocabularyKey(item.category)) ?? item.category.trim(),
        tags: item.tags.map(tag => {
          const trimmed = tag.trim()
          return canonicalTags.get(normalizeVocabularyKey(trimmed)) ?? trimmed
        }),
        description: item.description.trim()
      }))
    }
  )
}

export function parseTaxonomyPayload(content: unknown): Taxonomy {
  return taxonomyPayloadSchema.parse(content)
}

export function parseClassificationPayload(content: unknown): ClassificationResult[] {
  return classificationPayloadSchema.parse(content)
}

export function recommendedCategoryRange(bookmarkCount: number): { min: number; max: number } {
  if (bookmarkCount <= 1) return { min: 1, max: 1 }
  if (bookmarkCount <= 10) return { min: 1, max: Math.min(4, bookmarkCount) }
  if (bookmarkCount <= 20) return { min: 1, max: 5 }
  if (bookmarkCount <= 100) return { min: 1, max: 8 }
  return { min: 1, max: 12 }
}

export const defaultAiClient: AiClient = {
  isConfigured: isAiConfigured,
  listModels: listAiModels,
  proposeTaxonomy,
  classifyBookmarks
}

async function completeJson<T>(
  model: string,
  request: {
    name: string
    schema: Record<string, unknown>
    system: string
    user: string
  },
  validate: (content: unknown) => T
): Promise<T> {
  let lastError: unknown
  const maxRetries = 3
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await gatewayFetch('/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model,
          temperature: 0.1,
          messages: [
            {
              role: 'system',
              content: `${request.system}\n必须严格遵守以下 JSON Schema：${JSON.stringify(request.schema)}`
            },
            { role: 'user', content: request.user }
          ],
          response_format: {
            type: 'json_object'
          }
        })
      })
      const payload = (await response.json()) as CompletionResponse
      const rawContent = payload.choices?.[0]?.message?.content
      const text =
        typeof rawContent === 'string'
          ? rawContent
          : (rawContent ?? [])
              .filter(part => part.type === 'text' && typeof part.text === 'string')
              .map(part => part.text)
              .join('')
      if (!text?.trim()) {
        const finishReason = payload.choices?.[0]?.finish_reason
        throw new Error(
          `AI gateway returned an empty completion${finishReason ? ` (${finishReason})` : ''}`
        )
      }
      return validate(parseJsonContent(text))
    } catch (error) {
      lastError = error
      if (error instanceof AiGatewayError) throw error
      if (attempt === maxRetries) break

      const delayMs = retryDelay(attempt)
      logger.warn(
        {
          action: 'ai_completion_retry',
          name: request.name,
          model,
          attempt: attempt + 1,
          delayMs,
          error: error instanceof Error ? error.message : undefined
        },
        'Retrying invalid AI completion'
      )
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('AI completion failed')
}

export function parseJsonContent(text: string): unknown {
  const trimmed = text.trim()
  const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
  for (const match of fenced) {
    try {
      return JSON.parse(match[1].trim())
    } catch {
      // Try another fenced block or an embedded JSON value.
    }
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    // Some gateways ignore response_format and add prose around the JSON.
  }

  for (let start = 0; start < trimmed.length; start += 1) {
    if (trimmed[start] !== '{' && trimmed[start] !== '[') continue
    const candidate = balancedJsonValue(trimmed, start)
    if (!candidate) continue
    try {
      return JSON.parse(candidate)
    } catch {
      // Continue scanning for the next object or array.
    }
  }
  throw new SyntaxError('AI completion did not contain valid JSON')
}

function balancedJsonValue(text: string, start: number): string | undefined {
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{') stack.push('}')
    else if (character === '[') stack.push(']')
    else if (character === '}' || character === ']') {
      if (stack.pop() !== character) return undefined
      if (stack.length === 0) return text.slice(start, index + 1)
    }
  }
  return undefined
}

function containsChinese(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value)
}

function normalizeVocabularyKey(value: string): string {
  return value.trim().toLocaleLowerCase()
}

async function gatewayFetch(path: string, init: RequestInit): Promise<Response> {
  const baseUrl = config.aiGateway.baseUrl?.replace(/\/+$/, '')
  const apiKey = config.aiGateway.apiKey
  if (!baseUrl || !apiKey) throw new Error('AI gateway is not configured')

  return fetchWithRetry(
    `${baseUrl}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {})
      }
    },
    {
      timeoutMs: 60_000,
      onRetry: event => {
        logger.warn(
          {
            action: 'ai_gateway_retry',
            path,
            attempt: event.attempt,
            delayMs: event.delayMs,
            status: event.status,
            error: event.error instanceof Error ? event.error.message : undefined
          },
          'Retrying AI gateway request'
        )
      }
    }
  )
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RetryOptions = {}
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 3
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)))
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : init.signal
      })
      if (response.ok) return response

      const detail = await response.text()
      const error = new AiGatewayError(
        `AI gateway returned ${response.status}: ${detail.slice(0, 300)}`,
        response.status,
        isRetryableStatus(response.status)
      )
      if (!isRetryableStatus(response.status) || attempt === maxRetries) throw error

      const delayMs = retryDelay(attempt)
      options.onRetry?.({ attempt: attempt + 1, delayMs, status: response.status })
      await sleep(delayMs)
    } catch (error) {
      lastError = error
      if (isNonRetryableGatewayError(error) || attempt === maxRetries) throw error

      const delayMs = retryDelay(attempt)
      options.onRetry?.({ attempt: attempt + 1, delayMs, error })
      await sleep(delayMs)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('AI gateway request failed')
}

function retryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 10_000)
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function isNonRetryableGatewayError(error: unknown): boolean {
  return error instanceof AiGatewayError && !error.retryable
}
