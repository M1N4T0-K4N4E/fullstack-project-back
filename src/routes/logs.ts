import { Hono } from 'hono'
import { authMiddleware, type Variables } from '../middleware/auth.js'
import { USER_ROLES } from '../constants.js'
import { db } from '../db/index.js'
import { serverLogs, userInteractions } from '../db/schema.js'
import { desc } from 'drizzle-orm'
import { describeRoute } from 'hono-openapi'
import type { OpenAPIV3_1 } from 'openapi-types'
import { serverLogger } from '../utils/logger.js'
import * as fs from 'fs'
import path from 'path'

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
    method: { type: 'string' },
    path: { type: 'string' },
    status: { type: 'integer' },
    durationMs: { type: 'integer' },
    ip: { type: ['string', 'null'] },
    userAgent: { type: ['string', 'null'] },
    createdAt: { type: 'string' },
  },
};

// GET /api/logs/server - Get server logs from DB
logsAPI.get(
  '/server',
  describeRoute({
    operationId: 'getServerLogs',
    tags: ['logs'],
    summary: 'Get server logs',
    description: 'Fetch the most recent server logs from the database (admin only)',
    security: [{ Bearer: [] }],
    responses: {
      200: {
        description: 'Server logs list',
        content: {
          'application/json': {
            schema: { type: 'array', items: ServerLogSchema },
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
      const logs = await db.select().from(serverLogs).orderBy(desc(serverLogs.createdAt)).limit(100)
      return c.json(logs)
    } catch (e) {
      serverLogger.error('Failed to fetch server logs', { error: e })
      return c.json({ error: 'Failed to fetch server logs' }, 500)
    }
  }
)

// GET /api/logs/user - Get user interactions from DB
logsAPI.get(
  '/user',
  describeRoute({
    operationId: 'getUserInteractions',
    tags: ['logs'],
    summary: 'Get user interactions',
    description: 'Fetch the most recent user interactions from the database (admin only)',
    security: [{ Bearer: [] }],
    responses: {
      200: {
        description: 'User interactions list',
        content: {
          'application/json': {
            schema: { type: 'array', items: UserInteractionSchema },
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
      const interactions = await db.select().from(userInteractions).orderBy(desc(userInteractions.createdAt)).limit(100)
      return c.json(interactions)
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
