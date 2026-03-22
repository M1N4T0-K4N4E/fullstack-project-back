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
import { ARGON2_OPTIONS, PASSWORD_MIN_LENGTH } from '../constants.js'

const accountAPI = new Hono<{ Variables: Variables }>()

// Middleware to authenticate
accountAPI.use('/*', authMiddleware)

// GET /api/account - Get account info
accountAPI.get('/', async (c) => {
  const user = c.get('user');
  const { password, updatedAt, googleId, createdAt, ...safeUser } = user;
  return c.json(safeUser);
})

// PUT /api/account - Update account info
const updateAccountSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  avatarUrl: z.string().optional(),
});

accountAPI.put(
  '/',
  zValidator('json', updateAccountSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: 'Invalid input', details: result.error.issues }, 400);
    }
  }),
  async (c) => {
    const user = c.get('user');
    const { name, phone, avatarUrl } = c.req.valid('json');
    
    try {
      const [updatedUser] = await db.update(users)
        .set({
          name: name !== undefined ? name : user.name,
          phone: phone !== undefined ? phone : user.phone,
          avatarUrl: avatarUrl !== undefined ? avatarUrl : user.avatarUrl,
        })
        .where(eq(users.id, user.id))
        .returning();
        
      const { password, updatedAt, googleId, createdAt, ...safeUser } = updatedUser;
      return c.json({ message: 'Account updated successfully', user: safeUser });
    } catch (e) {
      serverLogger.error('Account update error', { error: e });
      return c.json({ error: 'Failed to update account' }, 500);
    }
  }
)

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(PASSWORD_MIN_LENGTH),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH),
});

accountAPI.put(
  '/password',
  zValidator('json', changePasswordSchema, (result, c) => {
    if (!result.success) return c.json({ error: 'Invalid input', details: result.error.issues }, 400);
  }),
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

      const nextTokenVersion = user.tokenVersion + 1;

      await db.update(users)
        .set({
          password: hashedNewPassword,
          tokenVersion: nextTokenVersion,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      const jwt = await new jose.SignJWT({
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tokenVersion: nextTokenVersion,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(secret);

      return c.json({ message: 'Password updated successfully', token: jwt });
    } catch (e) {
      serverLogger.error('Password change error', { error: e });
      return c.json({ error: 'Failed to change password' }, 500);
    }
  }
);

export default accountAPI
