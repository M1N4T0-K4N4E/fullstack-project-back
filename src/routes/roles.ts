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

const rolesAPI = new Hono<{ Variables: Variables }>()

rolesAPI.use(authMiddleware)

// GET /api/roles - List all roles
rolesAPI.get('/', (c) => {
  return c.json({ message: 'List all roles', roles: USER_ROLES })
})

// PUT /api/roles/ - Update a role
const updateRoleSchema = z.object({
  id: z.string(),
  role: z.enum([USER_ROLES.ADMIN, USER_ROLES.USER, USER_ROLES.MODERATOR]),
})

rolesAPI.put(
  '/',
  zValidator('json', updateRoleSchema, (result, c) => {
    if (!result.success) return c.json({ error: 'Invalid input' }, 400)
  }),
  async (c) => {
  const user = c.get('user')

  if (user.role !== USER_ROLES.ADMIN) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  
  try {
    const { id, role } = c.req.valid('json')

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
})

export default rolesAPI
