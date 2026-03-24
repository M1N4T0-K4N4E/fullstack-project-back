import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serverLogger, userInteractionLogger } from './utils/logger.js'
import roles from './routes/roles.js'
import posts from './routes/posts.js'
import account from './routes/account.js'
import auth from './routes/auth.js'
import upload from './routes/upload.js'
import users from './routes/users.js'
import { serveStatic } from '@hono/node-server/serve-static'

const app = new Hono()
app.use('*', userInteractionLogger)
app.use('*', cors({
  origin: 'http://localhost:3000',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))

app.use('/uploads/*', serveStatic({ root: './' }))

app.get('/', (c) => {
  return c.text('Tickale API')
})

// Mount API routes
app.route('/api/roles', roles)
app.route('/api/posts', posts)
app.route('/api/account', account)
app.route('/api/auth', auth)
app.route('/api/upload', upload)
app.route('/api/users', users)

serve({
  fetch: app.fetch,
  port: 3001
}, (info) => {
  serverLogger.info(`Server is running on http://localhost:${info.port}`)
})
