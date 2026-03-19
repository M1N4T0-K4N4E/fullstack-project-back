import { Hono } from 'hono'

const account = new Hono()

// GET /api/account - Get account info
account.get('/', (c) => {
  return c.json({ message: 'Get account info' })
})

// PUT /api/account - Update account info
account.put('/', (c) => {
  return c.json({ message: 'Update account info' })
})

export default account
