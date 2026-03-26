import { Hono } from 'hono'
import { serverLogger } from '../utils/logger.js'
import * as jose from 'jose'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import argon2 from 'argon2'
import { authMiddleware } from '../middleware/auth.js'
import type { Variables } from '../middleware/auth.js'
import { ARGON2_OPTIONS, PASSWORD_MIN_LENGTH, USER_ROLES, USER_STATUS } from '../constants.js'
import { describeRoute } from 'hono-openapi'
import type { OpenAPIV3_1 } from 'openapi-types'

const accountAPI = new Hono<{ Variables: Variables }>()
const secret = new TextEncoder().encode(process.env.JWT_SECRET);

accountAPI.use(authMiddleware)

// Zod Schemas for validation
const updateAccountSchema = z.object({
  name: z.string().optional(),
  avatarUrl: z.string().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH),
});

const banSchema = z.object({
  userId: z.string(),
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

const UserResponseSchema: OpenAPIV3_1.ResponseObject = {
  description: 'User account info',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: ['string', 'null'] },
          name: { type: ['string', 'null'] },
          role: { type: ['string', 'null'] },
          avatarUrl: { type: ['string', 'null'] },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' },
        },
      },
    },
  },
};

const UpdateAccountRequestSchema: OpenAPIV3_1.RequestBodyObject = {
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          avatarUrl: { type: 'string' },
        },
      },
    },
  },
};

const UpdateAccountResponseSchema: OpenAPIV3_1.ResponseObject = {
  description: 'Account updated successfully',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          token: { type: 'string' },
        },
      },
    },
  },
};

const ChangePasswordRequestSchema: OpenAPIV3_1.RequestBodyObject = {
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string' },
          newPassword: { type: 'string', minLength: PASSWORD_MIN_LENGTH },
        },
      },
    },
  },
};

const BanRequestSchema: OpenAPIV3_1.RequestBodyObject = {
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string' },
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

// GET /api/account - Get account info
accountAPI.get(
  '/',
  describeRoute({
    operationId: 'getAccount',
    tags: ['account'],
    summary: 'Get current user account',
    description: 'Get the account info of the currently authenticated user',
    security: [{ Bearer: [] }],
    responses: {
      200: UserResponseSchema,
      401: ErrorResponseSchema,
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { password, updatedAt, googleId, createdAt, ...safeUser } = user;
    return c.json(safeUser);
  }
)

// PUT /api/account - Update account info and sign new token with new info
accountAPI.put(
  '/',
  describeRoute({
    operationId: 'updateAccount',
    tags: ['account'],
    summary: 'Update account info',
    description: 'Update name and avatar URL, returns a new JWT token',
    security: [{ Bearer: [] }],
    requestBody: UpdateAccountRequestSchema,
    responses: {
      200: UpdateAccountResponseSchema,
      400: ErrorResponseSchema,
      401: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  zValidator('json', updateAccountSchema),
  async (c) => {
    const user = c.get('user');
    const { name, avatarUrl } = c.req.valid('json');

    try {
      const [updatedUser] = await db.update(users)
        .set({
          name: name ?? user.name,
          avatarUrl: avatarUrl ?? user.avatarUrl,
        })
        .where(eq(users.id, user.id))
        .returning();

      const jwt = await new jose.SignJWT({
        sub: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(secret);

      serverLogger.info('Account updated successfully', { user: updatedUser });
      return c.json({ message: 'Account updated successfully', token: jwt }, 200);
    } catch (e) {
      serverLogger.error('Account update error', { error: e });
      return c.json({ error: 'Failed to update account' }, 500);
    }
  }
)

// PUT /api/account/password - Change password
accountAPI.put(
  '/password',
  describeRoute({
    operationId: 'changePassword',
    tags: ['account'],
    summary: 'Change password',
    description: 'Change the current user password',
    security: [{ Bearer: [] }],
    requestBody: ChangePasswordRequestSchema,
    responses: {
      200: UpdateAccountResponseSchema,
      400: ErrorResponseSchema,
      401: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  zValidator('json', changePasswordSchema),
  async (c) => {
    const user = c.get('user');
    const { currentPassword, newPassword } = c.req.valid('json');

    try {
      if (!user.password) {
        return c.json({ error: 'Cannot change password for OAuth users' }, 400);
      }

      const isValid = await argon2.verify(user.password, currentPassword);
      if (!isValid) return c.json({ error: 'Invalid current password' }, 401);

      const hashedNewPassword = await argon2.hash(newPassword, ARGON2_OPTIONS);

      await db.update(users)
        .set({
          password: hashedNewPassword,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      const jwt = await new jose.SignJWT({
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(secret);

      serverLogger.info('Password changed successfully', { user: user });
      return c.json({ message: 'Password updated successfully', token: jwt }, 200);
    } catch (e) {
      serverLogger.error('Password change error', { error: e });
      return c.json({ error: 'Failed to change password' }, 500);
    }
  }
);

// PUT /api/account/ban - Ban account
accountAPI.put(
  '/ban',
  describeRoute({
    operationId: 'banUser',
    tags: ['account'],
    summary: 'Ban a user',
    description: 'Ban a user by user ID (admin only)',
    security: [{ Bearer: [] }],
    requestBody: BanRequestSchema,
    responses: {
      200: MessageResponseSchema,
      400: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  zValidator('json', banSchema),
  async (c) => {
    const user = c.get('user');
    const { userId } = c.req.valid('json');

    try {
      if (user.role !== USER_ROLES.ADMIN) {
        return c.json({ error: 'Forbidden' }, 403);
      }

      const targetUser = await db.query.users.findFirst({
        where: eq(users.id, userId)
      });

      if (!targetUser) {
        return c.json({ error: 'User not found' }, 404);
      }

      if (targetUser.role === USER_ROLES.ADMIN) {
        return c.json({ error: 'Forbidden. You cannot ban admin' }, 403);
      }

      if (targetUser.id === user.id) {
        return c.json({ error: 'Forbidden. You cannot ban yourself' }, 403);
      }

      await db.update(users)
        .set({
          status: USER_STATUS.BANNED,
          timeoutEnd: new Date(Date.now() + 24 * 60 * 60 * 1000),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      serverLogger.info('User banned successfully', { user: targetUser });
      return c.json({ message: 'User banned successfully' }, 200);
    } catch (e) {
      serverLogger.error('User ban error', { error: e });
      return c.json({ error: 'Failed to ban user' }, 500);
    }
  }
);


export default accountAPI
