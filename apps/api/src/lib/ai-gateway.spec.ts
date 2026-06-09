import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AiGatewayError,
  classifyBookmarks,
  fetchWithRetry,
  parseClassificationPayload,
  parseJsonContent,
  parseTaxonomyPayload,
  recommendedCategoryRange
} from './ai-gateway.js'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('AI gateway structured output parsing', () => {
  const classification = {
    itemId: 'item-1',
    category: '开发工具',
    tags: ['开发'],
    description: '代码托管平台'
  }

  it('accepts object-wrapped and top-level array classification results', () => {
    expect(parseClassificationPayload({ items: [classification] })).toEqual([classification])
    expect(parseClassificationPayload([classification])).toEqual([classification])
  })

  it('accepts object-wrapped and top-level array taxonomy results', () => {
    const categories = [{ name: '开发工具', description: '开发相关网站' }]
    expect(parseTaxonomyPayload({ categories })).toEqual(categories)
    expect(parseTaxonomyPayload(categories)).toEqual(categories)
  })

  it('still rejects malformed classification items', () => {
    expect(() =>
      parseClassificationPayload([{ ...classification, tags: [], description: '' }])
    ).toThrow()
  })

  it('requires exactly one AI-generated tag per bookmark', () => {
    expect(() =>
      parseClassificationPayload([{ ...classification, tags: ['开发', '代码托管'] }])
    ).toThrow()
  })

  it('uses broader category ranges for small imports', () => {
    expect(recommendedCategoryRange(1)).toEqual({ min: 1, max: 1 })
    expect(recommendedCategoryRange(8)).toEqual({ min: 1, max: 4 })
    expect(recommendedCategoryRange(14)).toEqual({ min: 1, max: 5 })
    expect(recommendedCategoryRange(50)).toEqual({ min: 1, max: 8 })
    expect(recommendedCategoryRange(200)).toEqual({ min: 1, max: 12 })
  })

  it('extracts JSON from Markdown fences and surrounding prose', () => {
    expect(parseJsonContent('结果如下：\\n```json\\n{"items":[]}\\n```')).toEqual({ items: [] })
    expect(parseJsonContent('Based on your bookmarks: [{"name":"开发工具"}] Thanks.')).toEqual([
      { name: '开发工具' }
    ])
  })

  it('rejects English-only generated descriptions', () => {
    expect(() =>
      parseClassificationPayload([
        {
          ...classification,
          description: 'A source code hosting platform.'
        }
      ])
    ).toThrow('Bookmark description must be Chinese')
  })
})

describe('AI gateway retry policy', () => {
  it('retries empty successful completions with backoff', async () => {
    vi.stubEnv('AI_NEW_API_BASE_URL', 'https://gateway.test/v1')
    vi.stubEnv('AI_NEW_API_KEY', 'test-key')
    const result = {
      itemId: 'item-1',
      category: '开发工具',
      tags: ['开发'],
      description: '代码托管平台'
    }
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ choices: [{ finish_reason: 'stop', message: { content: '' } }] })
      )
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: null } }] }))
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { content: JSON.stringify({ items: [result] }) } }] })
      )
    vi.stubGlobal('fetch', fetchImpl)
    vi.useFakeTimers()

    const completion = classifyBookmarks(
      'mock-model',
      [{ name: '开发工具' }],
      [{ itemId: 'item-1', title: 'GitHub', url: 'https://github.com', folderPath: '' }],
      []
    )
    await vi.runAllTimersAsync()

    await expect(completion).resolves.toEqual([result])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('retries transient responses with exponential backoff', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('busy', { status: 500 }))
      .mockResolvedValueOnce(new Response('limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const delays: number[] = []

    const response = await fetchWithRetry(
      'https://gateway.test/models',
      {},
      {
        fetchImpl,
        sleep: async delay => {
          delays.push(delay)
        }
      }
    )

    expect(response.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(delays).toEqual([1000, 2000])
  })

  it('does not retry non-retryable client errors', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('bad request', { status: 400 }))

    await expect(
      fetchWithRetry(
        'https://gateway.test/models',
        {},
        {
          fetchImpl,
          sleep: async () => undefined
        }
      )
    ).rejects.toMatchObject({ status: 400, retryable: false } satisfies Partial<AiGatewayError>)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('creates a fresh timeout signal for every attempt', async () => {
    const signals: Array<AbortSignal | null | undefined> = []
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      signals.push(init?.signal)
      if (signals.length === 1) throw new TypeError('network failure')
      return new Response('ok', { status: 200 })
    })

    await fetchWithRetry(
      'https://gateway.test/models',
      {},
      {
        fetchImpl,
        timeoutMs: 1000,
        sleep: async () => undefined
      }
    )

    expect(signals).toHaveLength(2)
    expect(signals[0]).not.toBe(signals[1])
  })
})
