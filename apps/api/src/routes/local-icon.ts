import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

const iconRoutes: FastifyPluginAsync = async app => {
  app.get('/icon', async request => {
    const query = z
      .object({ domain: z.string().optional(), url: z.string().optional() })
      .parse(request.query)
    const target = query.domain || query.url
    if (!target) {
      return {
        success: true,
        data: { url: '/icons/default.svg', source: 'default' }
      }
    }
    try {
      const url = new URL(/^https?:\/\//i.test(target) ? target : `https://${target}`)
      return {
        success: true,
        data: {
          url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=64`,
          source: 'google'
        }
      }
    } catch {
      return {
        success: true,
        data: { url: '/icons/default.svg', source: 'default' }
      }
    }
  })
}

export default iconRoutes
