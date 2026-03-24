import { Hono } from 'hono'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth.js'
import type { Variables } from '../middleware/auth.js'
import { USER_ROLES } from '../constants.js'
import { serverLogger } from '../utils/logger.js'

const usersAPI = new Hono<{ Variables: Variables }>()

// Middleware to ensure only admins can access these routes
usersAPI.use(authMiddleware, async (c, next) => {
  const user = c.get('user')
  if (user.role !== USER_ROLES.ADMIN) {
    return c.json({ error: 'Forbidden. ' }, 403)
  }
  await next()
})

// Safe user selection
const safeUserSelect = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  avatarUrl: users.avatarUrl,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
}

// GET /api/users - List all users
usersAPI.get('/', async (c) => {
  try {
    const allUsers = await db.select(safeUserSelect).from(users)
    serverLogger.info('Users fetched successfully', { userCount: allUsers.length })
    return c.json({ message: 'Users fetched successfully', users: allUsers }, 200)
  } catch (e) {
    serverLogger.error('Failed to fetch users', { error: e })
    return c.json({ error: 'Failed to fetch users' }, 500)
  }
})

// GET /api/users/:id - Get user by id
usersAPI.get('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const [user] = await db.select(safeUserSelect)
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
})

// GET /api/users/id/:id - Get user by id
usersAPI.get('/id/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const [user] = await db.select(safeUserSelect)
      .from(users)
      .where(eq(users.id, id))
    
    if (!user) {
      return c.json({ error: 'User not found' }, 404)
    }
    
    serverLogger.info('User fetched successfully', { userId: id })
    return c.json({ message: 'User fetched successfully', user: user }, 200)
  } catch (e) {
    serverLogger.error('Failed to fetch user by id', { error: e })
    return c.json({ error: 'Failed to fetch user by id' }, 500)
  }
})

export default usersAPI
