import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serverLogger, userInteractionLogger } from './utils/logger.js'
import roles from './routes/roles.js'
import posts from './routes/posts.js'
import account from './routes/account.js'
import auth from './routes/auth.js'
import users from './routes/users.js'
import { serveStatic } from '@hono/node-server/serve-static'
import { openAPIRouteHandler } from 'hono-openapi'

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
  return c.text('Shaderd API')
})

// Mount API routes
app.route('/api/account', account)
app.route('/api/auth', auth)
app.route('/api/posts', posts)
app.route('/api/roles', roles)
app.route('/api/users', users)

// OpenAPI documentation endpoint
app.get(
  '/doc',
  openAPIRouteHandler(app, {
    documentation: {
      info: {
        title: 'Shaderd API',
        description: 'API documentation for Shaderd - A shader sharing platform',
        version: '1.0.0',
      },
      servers: [
        {
          url: 'http://localhost:3001',
          description: 'Development server',
        },
      ],
    },
  })
)

serve({
  fetch: app.fetch,
  port: 3001
}, (info) => {
  serverLogger.info(`Server is running on http://localhost:${info.port}`)
})
