import { load } from 'cheerio'
import { z } from 'zod'

export interface ParsedBookmark {
  title: string
  url: string
  folderPath: string
  description?: string
  categoryName?: string
  tagNames?: string[]
}

const projectJsonSchema = z.object({
  data: z
    .object({
      websites: z.array(z.record(z.unknown())).default([]),
      categories: z.array(z.record(z.unknown())).default([]),
      tags: z.array(z.record(z.unknown())).default([])
    })
    .optional(),
  websites: z.array(z.record(z.unknown())).optional(),
  categories: z.array(z.record(z.unknown())).optional(),
  tags: z.array(z.record(z.unknown())).optional()
})

export function normalizeUrl(rawUrl: string): string {
  const raw = rawUrl.trim()
  if (!raw) throw new Error('URL is empty')
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  const url = new URL(withProtocol)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs are supported')
  }
  url.hostname = url.hostname.toLowerCase()
  url.hash = ''
  if (
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80')
  ) {
    url.port = ''
  }
  if (url.pathname !== '/') {
    url.pathname = url.pathname.replace(/\/+$/, '')
  }
  return url.toString()
}

export function parseBookmarkFile(
  filename: string,
  content: string
): { format: 'html' | 'json'; bookmarks: ParsedBookmark[] } {
  const lowerName = filename.toLowerCase()
  if (lowerName.endsWith('.json') || content.trimStart().startsWith('{')) {
    return { format: 'json', bookmarks: parseProjectJson(content) }
  }
  return { format: 'html', bookmarks: parseNetscapeHtml(content) }
}

export function parseNetscapeHtml(content: string): ParsedBookmark[] {
  const bookmarks: ParsedBookmark[] = []
  const folders: string[] = []
  let pendingFolder: string | undefined
  const tokenPattern =
    /<\/?DL\b[^>]*>|<H3\b[^>]*>[\s\S]*?<\/H3>|<A\b[^>]*\bHREF\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/A>/gi

  for (const match of content.matchAll(tokenPattern)) {
    const token = match[0]
    if (/^<H3\b/i.test(token)) {
      pendingFolder = textContent(token.replace(/^<H3\b[^>]*>|<\/H3>$/gi, '')).trim()
      continue
    }
    if (/^<DL\b/i.test(token)) {
      folders.push(pendingFolder ?? '')
      pendingFolder = undefined
      continue
    }
    if (/^<\/DL/i.test(token)) {
      folders.pop()
      continue
    }
    if (/^<A\b/i.test(token)) {
      const url = (match[1] ?? match[2] ?? match[3] ?? '').trim()
      const title = textContent(match[4] ?? '').trim() || url
      bookmarks.push({
        title,
        url,
        folderPath: folders.filter(Boolean).join(' / ')
      })
    }
  }
  return bookmarks
}

export function parseProjectJson(content: string): ParsedBookmark[] {
  const parsed = projectJsonSchema.parse(JSON.parse(content))
  const data = parsed.data ?? parsed
  const categories = data.categories ?? []
  const tags = data.tags ?? []
  const websites = data.websites ?? []
  const categoryNames = new Map(
    categories
      .filter(item => typeof item.id === 'string' && typeof item.name === 'string')
      .map(item => [String(item.id), String(item.name)])
  )
  const tagNames = new Map(
    tags
      .filter(item => typeof item.id === 'string' && typeof item.name === 'string')
      .map(item => [String(item.id), String(item.name)])
  )

  return websites.map(item => {
    const categoryName =
      typeof item.categoryId === 'string' ? categoryNames.get(item.categoryId) : undefined
    const itemTagNames = Array.isArray(item.tagIds)
      ? item.tagIds
          .map(id => (typeof id === 'string' ? tagNames.get(id) : undefined))
          .filter((name): name is string => Boolean(name))
      : []
    return {
      title: typeof item.name === 'string' ? item.name : String(item.url ?? ''),
      url: typeof item.url === 'string' ? item.url : '',
      folderPath: categoryName ?? '',
      categoryName,
      tagNames: itemTagNames,
      description: typeof item.description === 'string' ? item.description : undefined
    }
  })
}

function textContent(html: string): string {
  return load(`<span>${html}</span>`)('span').text()
}
