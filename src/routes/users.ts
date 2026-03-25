import { Hono } from 'hono'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth.js'
import type { Variables } from '../middleware/auth.js'
import { USER_ROLES, USER_STATUS } from '../constants.js'
import { serverLogger } from '../utils/logger.js'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { describeRoute } from 'hono-openapi'
import type { OpenAPIV3_1 } from 'openapi-types'

const usersAPI = new Hono<{ Variables: Variables }>()

// Middleware to ensure only admins can access these routes
usersAPI.use(authMiddleware, async (c, next) => {
  const user = c.get('user')
  if (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.MODERATOR) {
    return c.json({ error: 'Forbidden. ' }, 403)
  }
  await next()
})

// Safe user selection
const userSelect = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  status: users.status,
  avatarUrl: users.avatarUrl,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
}

const timeoutSchema = z.object({
  duration: z.number().int().positive(),
});

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

const UserSchema: OpenAPIV3_1.SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    email: { type: ['string', 'null'] },
    name: { type: ['string', 'null'] },
    role: { type: ['string', 'null'] },
    status: { type: ['string', 'null'] },
    avatarUrl: { type: ['string', 'null'] },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
};

const UserListResponseSchema: OpenAPIV3_1.ResponseObject = {
  description: 'List of users',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          users: {
            type: 'array',
            items: UserSchema,
          },
        },
      },
    },
  },
};

const UserResponseSchema: OpenAPIV3_1.ResponseObject = {
  description: 'User info',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          user: UserSchema,
        },
      },
    },
  },
};

const TimeoutRequestSchema: OpenAPIV3_1.RequestBodyObject = {
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['duration'],
        properties: {
          duration: { type: 'integer', minimum: 1, description: 'Timeout duration in hours' },
        },
      },
    },
  },
};

const TimeoutResponseSchema: OpenAPIV3_1.ResponseObject = {
  description: 'User timeout set successfully',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          user: UserSchema,
        },
      },
    },
  },
};

// GET /api/users - List all users
usersAPI.get(
  '/',
  describeRoute({
    operationId: 'listUsers',
    tags: ['users'],
    summary: 'List all users',
    description: 'Get a list of all users (admin only)',
    security: [{ Bearer: [] }],
    responses: {
      200: UserListResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  async (c) => {
    try {
      const allUsers = await db.select(userSelect).from(users)
      serverLogger.info('Users fetched successfully', { userCount: allUsers.length })
      return c.json({ message: 'Users fetched successfully', users: allUsers }, 200)
    } catch (e) {
      serverLogger.error('Failed to fetch users', { error: e })
      return c.json({ error: 'Failed to fetch users' }, 500)
    }
  }
)

// GET /api/users/:id - Get user by id
usersAPI.get(
  '/:id',
  describeRoute({
    operationId: 'getUser',
    tags: ['users'],
    summary: 'Get user by ID',
    description: 'Get user info by ID (admin only)',
    security: [{ Bearer: [] }],
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ],
    responses: {
      200: UserResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  async (c) => {
    const id = c.req.param('id')
    try {
      const [user] = await db.select(userSelect)
        .from(users)
        .where(eq(users.id, id))

      if (!user) {
        return c.json({ error: 'User not found' }, 404)
      }

      serverLogger.info('User fetched successfully', { userId: id })
      return c.json({ message: 'User fetched successfully', user: user }, 200)
    } catch (e) {
      serverLogger.error('Failed to fetch user detail', { error: e })
      return c.json({ error: 'Failed to fetch user detail' }, 500)
    }
  }
)

// GET /api/users/id/:id - Get user by id (alternative route)
usersAPI.get(
  '/id/:id',
  describeRoute({
    operationId: 'getUserById',
    tags: ['users'],
    summary: 'Get user by ID (alternative)',
    description: 'Get user info by ID using /id/:id route (admin only)',
    security: [{ Bearer: [] }],
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ],
    responses: {
      200: UserResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  async (c) => {
    const id = c.req.param('id')
    try {
      const [user] = await db.select(userSelect)
        .from(users)
        .where(eq(users.id, id))

      if (!user) {
        return c.json({ error: 'User not found' }, 404)
      }

      serverLogger.info('User fetched successfully', { userId: id })
      return c.json({ message: 'User fetched successfully', user: user }, 200)
    } catch (e) {
      serverLogger.error('Failed to fetch user by id', { error: e })
      return c.json({ error: 'Failed to fetch user detail' }, 500)
    }
  }
)

// POST /api/users/timeout/:id - Set user timeout, duration in Hrs
usersAPI.post(
  '/timeout/:id',
  describeRoute({
    operationId: 'setUserTimeout',
    tags: ['users'],
    summary: 'Set user timeout',
    description: 'Set a timeout on a user account (admin only)',
    security: [{ Bearer: [] }],
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ],
    requestBody: TimeoutRequestSchema,
    responses: {
      200: TimeoutResponseSchema,
      400: ErrorResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  zValidator('json', timeoutSchema),
  async (c) => {
    const id = c.req.param('id')
    const { duration } = c.req.valid('json')
    try {
      const [user] = await db.select(userSelect)
        .from(users)
        .where(eq(users.id, id))

      if (!user) {
        return c.json({ error: 'User not found' }, 404)
      }

      if (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.MODERATOR) {
        return c.json({ error: 'Forbidden. You cannot timeout admin or moderator' }, 403)
      }

      if (user.id === id) {
        return c.json({ error: 'Forbidden. You cannot timeout yourself' }, 403)
      }

      const [updatedUser] = await db.update(users)
        .set({
          timeoutEnd: new Date(Date.now() + duration * 60 * 60 * 1000),
          status: USER_STATUS.TIMEOUT,
        })
        .where(eq(users.id, id))
        .returning()

      serverLogger.info('Timeout user successfully', { userId: id })
      return c.json({ message: 'Timeout user successfully', user: updatedUser }, 200)
    } catch (e) {
      serverLogger.error('Failed to timeout user', { error: e })
      return c.json({ error: 'Failed to timeout user' }, 500)
    }
  }
)

export default usersAPI
