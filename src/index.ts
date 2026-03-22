import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serverLogger, userInteractionLogger } from './utils/logger.js'
import { db } from './db/index.js'
import { blacklistedTokens } from './db/schema.js'
import { lt } from 'drizzle-orm'
import roles from './routes/roles.js'
import events from './routes/events.js'
import account from './routes/account.js'
import tickets from './routes/tickets.js'
import auth from './routes/auth.js'
import upload from './routes/upload.js'
import users from './routes/users.js'
import { serveStatic } from '@hono/node-server/serve-static'

const app = new Hono()
app.use('*', userInteractionLogger)
app.use('*', cors({
  origin: 'http://localhost:5173',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))

app.use('/uploads/*', serveStatic({ root: './' }))

app.get('/', (c) => {
  return c.text('Tickale API')
})

// Mount API routes
app.route('/api/roles', roles)
app.route('/api/events', events)
app.route('/api/account', account)
app.route('/api/tickets', tickets)
app.route('/api/auth', auth)
app.route('/api/upload', upload)
app.route('/api/users', users)

serve({
  fetch: app.fetch,
  port: 3001
}, (info) => {
  serverLogger.info(`Server is running on http://localhost:${info.port}`)
})

// Background job to clean up expired blacklisted tokens every 12 hours
setInterval(async () => {
  try {
    await db.delete(blacklistedTokens).where(lt(blacklistedTokens.expiresAt, new Date()));
    serverLogger.info('Cleaned up expired blacklisted tokens scheduling job completed');
  } catch (error) {
    serverLogger.error('Failed to clean up blacklisted tokens', { error });
  }
}, 1000 * 60 * 60 * 12);
