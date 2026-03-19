import { Hono } from 'hono'

const tickets = new Hono()

// GET /api/tickets - List tickets (report)
tickets.get('/', (c) => {
  return c.json({ message: 'List all tickets' })
})

// GET /api/tickets/:id - Ticket detail
tickets.get('/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ message: `Ticket detail ${id}` })
})

// POST /api/tickets - Buy/create a ticket
tickets.post('/', (c) => {
  return c.json({ message: 'Buy a ticket' })
})

// DELETE /api/tickets/:id - Cancel a ticket
tickets.delete('/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ message: `Cancel ticket ${id}` })
})

export default tickets
