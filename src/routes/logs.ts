import { Hono } from 'hono'
import { authMiddleware, type Variables } from '../middleware/auth.js'
import { PAGINATION, USER_ROLES } from '../constants.js'
import { db } from '../db/index.js'
import { serverLogs, userInteractions } from '../db/schema.js'
import { desc, sql } from 'drizzle-orm'
import { describeRoute } from 'hono-openapi'
import type { OpenAPIV3_1 } from 'openapi-types'
import { serverLogger } from '../utils/logger.js'
import * as fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

const logsAPI = new Hono<{ Variables: Variables }>()

// Middleware to ensure only admins can access logs
logsAPI.use(authMiddleware, async (c, next) => {
  const user = c.get('user')
  if (user.role !== USER_ROLES.ADMIN) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await next()
})



// OpenAPI Response Schemas
const ErrorResponseSchema: OpenAPIV3_1.ResponseObject = {
  description: 'Error response',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          error: { type: 'string' },
        },
      },
    },
  },
};

const ServerLogSchema: OpenAPIV3_1.SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    level: { type: 'string' },
    message: { type: 'string' },
    meta: { type: ['object', 'null'] },
    createdAt: { type: 'string' },
  },
};

const UserInteractionSchema: OpenAPIV3_1.SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    userEmail: { type: 'string' },
    userRole: { type: 'string' },
    action: { type: 'string' },
    method: { type: 'string' },
    path: { type: 'string' },
    status: { type: 'integer' },
    durationMs: { type: 'integer' },
    ip: { type: ['string', 'null'] },
    userAgent: { type: ['string', 'null'] },
    createdAt: { type: 'string' },
  },
};

const PaginationParams = z.object({
  page: z.string().default(String(PAGINATION.DEFAULT_PAGE)).transform(Number).pipe(z.number().int().min(PAGINATION.DEFAULT_PAGE)),
  limit: z.string().default(String(PAGINATION.DEFAULT_LIMIT)).transform(Number).pipe(z.number().int().min(PAGINATION.MIN_LIMIT).max(PAGINATION.MAX_LIMIT)),
});

const PaginatedLogsResponseSchema: OpenAPIV3_1.ResponseObject = {
  description: 'Paginated logs list',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          data: { type: 'array', items: ServerLogSchema },
          total: { type: 'integer' },
          page: { type: 'integer' },
          limit: { type: 'integer' },
          totalPages: { type: 'integer' },
        },
      },
    },
  },
};

const PaginatedInteractionsResponseSchema: OpenAPIV3_1.ResponseObject = {
  description: 'Paginated user interactions list',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          data: { type: 'array', items: UserInteractionSchema },
          total: { type: 'integer' },
          page: { type: 'integer' },
          limit: { type: 'integer' },
          totalPages: { type: 'integer' },
        },
      },
    },
  },
};

// GET /api/logs/server - Get server logs from DB (paginated)
logsAPI.get(
  '/server',
  describeRoute({
    operationId: 'getServerLogs',
    tags: ['logs'],
    summary: 'Get server logs (paginated)',
    description: 'Fetch server logs from the database with pagination (admin only)',
    security: [{ Bearer: [] }],
    parameters: [
      {
        name: 'page',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: PAGINATION.DEFAULT_PAGE, minimum: PAGINATION.DEFAULT_PAGE },
        description: 'Page number (starts at 1)',
      },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: PAGINATION.DEFAULT_LIMIT, minimum: PAGINATION.MIN_LIMIT, maximum: PAGINATION.MAX_LIMIT },
        description: 'Number of logs per page',
      },
    ],
    responses: {
      200: PaginatedLogsResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  zValidator('query', PaginationParams),
  async (c) => {
    try {
      const { page, limit } = c.req.valid('query')
      const offset = (page - 1) * limit
      
      const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(serverLogs)
      const logs = await db.select().from(serverLogs).orderBy(desc(serverLogs.createdAt)).limit(limit).offset(offset)
      
      const totalPages = Math.ceil(count / limit)
      return c.json({ data: logs, total: count, page, limit, totalPages }, 200)
    } catch (e) {
      serverLogger.error('Failed to fetch server logs', { error: e })
      return c.json({ error: 'Failed to fetch server logs' }, 500)
    }
  }
)

// GET /api/logs/user - Get user interactions from DB (paginated)
logsAPI.get(
  '/user',
  describeRoute({
    operationId: 'getUserInteractions',
    tags: ['logs'],
    summary: 'Get user interactions (paginated)',
    description: 'Fetch user interactions from the database with pagination (admin only)',
    security: [{ Bearer: [] }],
    parameters: [
      {
        name: 'page',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: PAGINATION.DEFAULT_PAGE, minimum: PAGINATION.DEFAULT_PAGE },
        description: 'Page number (starts at 1)',
      },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: PAGINATION.DEFAULT_LIMIT, minimum: PAGINATION.MIN_LIMIT, maximum: PAGINATION.MAX_LIMIT },
        description: 'Number of interactions per page',
      },
    ],
    responses: {
      200: PaginatedInteractionsResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  zValidator('query', PaginationParams),
  async (c) => {
    try {
      const { page, limit } = c.req.valid('query')
      const offset = (page - 1) * limit
      
      const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(userInteractions)
      const interactions = await db.select().from(userInteractions).orderBy(desc(userInteractions.createdAt)).limit(limit).offset(offset)
      
      const totalPages = Math.ceil(count / limit)
      return c.json({ data: interactions, total: count, page, limit, totalPages }, 200)
    } catch (e) {
      serverLogger.error('Failed to fetch user interactions', { error: e })
      return c.json({ error: 'Failed to fetch user interactions' }, 500)
    }
  }
)

// GET /api/logs/files - List log files
logsAPI.get(
  '/files',
  describeRoute({
    operationId: 'listLogFiles',
    tags: ['logs'],
    summary: 'List log files',
    description: 'List all log files in the logs directory (admin only)',
    security: [{ Bearer: [] }],
    responses: {
      200: {
        description: 'Log files list',
        content: {
          'application/json': {
            schema: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  async (c) => {
    try {
      const logDir = path.join(process.cwd(), 'logs')
      if (!fs.existsSync(logDir)) {
        return c.json([])
      }
      const files = fs.readdirSync(logDir).filter(f => f.endsWith('.log'))
      return c.json(files)
    } catch (e) {
      serverLogger.error('Failed to list log files', { error: e })
      return c.json({ error: 'Failed to list log files' }, 500)
    }
  }
)

// GET /api/logs/files/:filename - Get a specific log file content
logsAPI.get(
  '/files/:filename',
  describeRoute({
    operationId: 'getLogFileContent',
    tags: ['logs'],
    summary: 'Get log file content',
    description: 'Read the content of a specific log file (admin only)',
    security: [{ Bearer: [] }],
    parameters: [
      {
        name: 'filename',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ],
    responses: {
      200: {
        description: 'Log file content',
        content: {
          'text/plain': {
            schema: { type: 'string' },
          },
        },
      },
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  async (c) => {
    const filename = c.req.param('filename')
    try {
      const filePath = path.join(process.cwd(), 'logs', filename)
      if (!fs.existsSync(filePath) || !filename.endsWith('.log')) {
        return c.json({ error: 'Log file not found' }, 404)
      }
      const content = fs.readFileSync(filePath, 'utf8')
      return c.text(content)
    } catch (e) {
      serverLogger.error('Failed to read log file', { error: e, filename })
      return c.json({ error: 'Failed to read log file' }, 500)
    }
  }
)

export default logsAPI
