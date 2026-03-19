import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import roles from './routes/roles.js'
import events from './routes/events.js'
import account from './routes/account.js'
import tickets from './routes/tickets.js'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Tickale API')
})

// Mount API routes
app.route('/api/roles', roles)
app.route('/api/events', events)
app.route('/api/account', account)
app.route('/api/tickets', tickets)

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
