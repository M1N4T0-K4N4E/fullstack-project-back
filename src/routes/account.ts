import { Hono } from 'hono'
import * as jose from 'jose'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

import { authMiddleware } from '../middleware/auth.js'
import type { Variables } from '../middleware/auth.js'

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
      console.error('Account update error:', e);
      return c.json({ error: 'Failed to update account' }, 500);
    }
  }
)

export default accountAPI
