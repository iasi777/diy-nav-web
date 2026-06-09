import { describe, expect, it } from 'vitest'
import { normalizeUrl, parseNetscapeHtml, parseProjectJson } from './bookmark-import.js'

describe('bookmark import parsing', () => {
  it('preserves nested Netscape folders and decodes titles', () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
      <DL><p>
        <DT><H3>开发</H3>
        <DL><p>
          <DT><H3>代码</H3>
          <DL><p>
            <DT><A HREF="https://github.com/">GitHub &amp; Projects</A>
          </DL><p>
        </DL><p>
      </DL><p>`
    expect(parseNetscapeHtml(html)).toEqual([
      {
        title: 'GitHub & Projects',
        url: 'https://github.com/',
        folderPath: '开发 / 代码'
      }
    ])
  })

  it('reads project JSON category, tags, and description', () => {
    const bookmarks = parseProjectJson(
      JSON.stringify({
        data: {
          categories: [{ id: 'c1', name: '开发' }],
          tags: [{ id: 't1', name: 'Git' }],
          websites: [
            {
              name: 'GitHub',
              url: 'https://github.com',
              categoryId: 'c1',
              tagIds: ['t1'],
              description: '代码托管'
            }
          ]
        }
      })
    )
    expect(bookmarks[0]).toMatchObject({
      title: 'GitHub',
      categoryName: '开发',
      tagNames: ['Git'],
      description: '代码托管'
    })
  })
})

describe('normalizeUrl', () => {
  it('normalizes protocol, host, default port, fragment, and trailing slash', () => {
    expect(normalizeUrl('Example.COM:443/path/#section')).toBe('https://example.com/path')
    expect(normalizeUrl('HTTP://EXAMPLE.COM:80/')).toBe('http://example.com/')
  })

  it('rejects non-http schemes', () => {
    expect(() => normalizeUrl('javascript:alert(1)')).toThrow()
  })
})
