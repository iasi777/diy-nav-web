import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import staticPlugin from '@fastify/static'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ZodError } from 'zod'
import { config } from '@nav/config'
import { configs } from '@nav/logger'
import { closeDatabase, getDatabase } from './src/lib/sqlite.js'
import libraryRoutes from './src/routes/library.js'
import importRoutes from './src/routes/imports.js'
import systemRoutes from './src/routes/system.js'
import iconRoutes from './src/routes/local-icon.js'
import type { AiClient } from './src/lib/ai-gateway.js'

export interface BuildAppOptions {
  aiClient?: AiClient
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.server.env === 'test' ? false : configs.node,
    bodyLimit: 26 * 1024 * 1024,
    trustProxy: true
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: error.issues
      })
    }
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500
    if (statusCode >= 500) request.log.error(error)
    else request.log.warn({ err: error }, 'Request rejected')
    const message = error instanceof Error ? error.message : 'Request failed'
    return reply.code(statusCode).send({
      success: false,
      code: statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_ERROR',
      message: statusCode === 500 ? 'Internal Server Error' : message
    })
  })

  await app.register(cors, {
    origin: [/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['content-type']
  })
  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    skipOnError: true
  })
  await app.register(staticPlugin, {
    root: resolve(process.cwd(), 'public'),
    prefix: '/'
  })

  getDatabase()
  app.get('/healthz', { config: { rateLimit: false } }, async () => ({ status: 'ok' }))
  app.get('/readyz', { config: { rateLimit: false } }, async (_request, reply) => {
    const result = getDatabase().pragma('quick_check') as Array<{ quick_check: string }>
    if (result[0]?.quick_check !== 'ok') {
      return reply.code(503).send({ status: 'not-ready', database: result })
    }
    return { status: 'ready', database: 'ok' }
  })

  await app.register(iconRoutes, { prefix: '/api' })
  await app.register(libraryRoutes, { prefix: '/api' })
  await app.register(importRoutes, { prefix: '/api', aiClient: options.aiClient })
  await app.register(systemRoutes, { prefix: '/api' })
  app.addHook('onClose', async () => closeDatabase())

  return app
}

export async function start(): Promise<void> {
  const app = await buildApp()
  const port = config.server.port
  const host = config.server.env === 'production' ? '0.0.0.0' : '127.0.0.1'
  await app.listen({ port, host })
  app.log.info(`Server listening on port ${port} in ${config.server.env} mode`)

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, async () => {
      app.log.info(`Received ${signal}, shutting down`)
      await app.close()
      process.exit(0)
    })
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === entrypoint) {
  start().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error)
    process.exit(1)
  })
}
