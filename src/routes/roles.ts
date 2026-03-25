import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth.js'
import type { Variables } from '../middleware/auth.js'
import { USER_ROLES } from '../constants.js'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { serverLogger } from '../utils/logger.js'
import { describeRoute } from 'hono-openapi'
import type { OpenAPIV3_1 } from 'openapi-types'

const rolesAPI = new Hono<{ Variables: Variables }>()

rolesAPI.use(authMiddleware)

const updateRoleSchema = z.object({
  id: z.string(),
  role: z.enum([USER_ROLES.ADMIN, USER_ROLES.USER, USER_ROLES.MODERATOR]),
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

const RolesResponseSchema: OpenAPIV3_1.ResponseObject = {
  description: 'List of roles',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          roles: {
            type: 'object',
            properties: {
              ADMIN: { type: 'string' },
              USER: { type: 'string' },
              MODERATOR: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

const UpdateRoleRequestSchema: OpenAPIV3_1.RequestBodyObject = {
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['id', 'role'],
        properties: {
          id: { type: 'string' },
          role: { type: 'string', enum: [USER_ROLES.ADMIN, USER_ROLES.USER, USER_ROLES.MODERATOR] },
        },
      },
    },
  },
};

const MessageResponseSchema: OpenAPIV3_1.ResponseObject = {
  description: 'Success message',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
        },
      },
    },
  },
};

// GET /api/roles - List all roles
rolesAPI.get(
  '/',
  describeRoute({
    operationId: 'listRoles',
    tags: ['roles'],
    summary: 'List all roles',
    description: 'Get a list of all available user roles',
    responses: {
      200: RolesResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  (c) => {
    try {
      serverLogger.info('Role list requested')
      return c.json({ message: 'List all roles', roles: USER_ROLES }, 200)
    } catch (error) {
      serverLogger.error('Role list error', { error })
      return c.json({ error: 'Role list failed' }, 500)
    }
  }
)

// PUT /api/roles/ - Update a role
rolesAPI.put(
  '/',
  describeRoute({
    operationId: 'updateRole',
    tags: ['roles'],
    summary: 'Update user role',
    description: 'Update a user role (admin only)',
    security: [{ Bearer: [] }],
    requestBody: UpdateRoleRequestSchema,
    responses: {
      200: MessageResponseSchema,
      400: ErrorResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  zValidator('json', updateRoleSchema),
  async (c) => {
    const user = c.get('user')

    if (user.role !== USER_ROLES.ADMIN) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    try {
      const { id, role } = c.req.valid('json')

      const targetUser = await db.query.users.findFirst({
        where: eq(users.id, id)
      })

      if (!targetUser) {
        return c.json({ error: 'User not found' }, 404)
      }

      if (targetUser.role === USER_ROLES.ADMIN) {
        return c.json({ error: 'Forbidden. You cannot update admin role' }, 403)
      }

      if (user.id === id) {
        return c.json({ error: 'Forbidden. You cannot update your role' }, 403)
      }

      await db.update(users)
        .set({
          role,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))

      serverLogger.info('Role updated successfully', { userId: id, role })
      return c.json({ message: `Update role user ${id} to ${role}` })
    } catch (error) {
      serverLogger.error('Role update error', { error })
      return c.json({ error: 'Role update failed' }, 500)
    }
  }
)

export default rolesAPI
