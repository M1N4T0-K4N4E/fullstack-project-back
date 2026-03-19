import { Hono } from 'hono'

const events = new Hono()

// GET /api/events - List all events
events.get('/', (c) => {
  return c.json({ message: 'List all events' })
})

// GET /api/events/:id - Get event detail
events.get('/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ message: `Event detail ${id}` })
})

// POST /api/events - Create an event
events.post('/', (c) => {
  return c.json({ message: 'Create an event' })
})

// PUT /api/events/:id - Update an event
events.put('/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ message: `Update event ${id}` })
})

// DELETE /api/events/:id - Delete an event
events.delete('/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ message: `Delete event ${id}` })
})

export default events
