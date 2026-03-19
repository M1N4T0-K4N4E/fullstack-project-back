import { Hono } from 'hono'

const roles = new Hono()

// GET /api/roles - List all roles
roles.get('/', (c) => {
  return c.json({ message: 'List all roles' })
})

// POST /api/roles - Create a role
roles.post('/', (c) => {
  return c.json({ message: 'Create a role' })
})

// PUT /api/roles/:id - Update a role
roles.put('/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ message: `Update role ${id}` })
})

// DELETE /api/roles/:id - Delete a role
roles.delete('/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ message: `Delete role ${id}` })
})

export default roles
