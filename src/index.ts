import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import roles from './routes/roles.js'
import events from './routes/events.js'
import account from './routes/account.js'
import tickets from './routes/tickets.js'
import auth from './routes/auth.js'

const app = new Hono()
app.use('*', logger())
app.use('*', cors({
  origin: 'http://localhost:5173',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))

app.get('/', (c) => {
  return c.text('Tickale API')
})

// Mount API routes
app.route('/api/roles', roles)
app.route('/api/events', events)
app.route('/api/account', account)
app.route('/api/tickets', tickets)
app.route('/api/auth', auth)

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
