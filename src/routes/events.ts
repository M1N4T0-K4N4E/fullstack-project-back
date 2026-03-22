import { Hono } from 'hono'
import { serverLogger } from '../utils/logger.js'
import { db } from '../db/index.js'
import { events } from '../db/schema.js'
import { eq, gte } from 'drizzle-orm'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware } from '../middleware/auth.js'
import type { Variables } from '../middleware/auth.js'
import { USER_ROLES, EVENT_STATUS } from '../constants.js'

const eventsAPI = new Hono<{ Variables: Variables }>()

// GET /api/events - List all current events
eventsAPI.get('/', async (c) => {
  try {
    const allEvents = await db.query.events.findMany({
      where: gte(events.date, new Date())
    })
    return c.json(allEvents)
  } catch (e) {
    return c.json({ error: 'Failed to fetch events' }, 500)
  }
})

// GET /api/events/:id - Get event detail
eventsAPI.get('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const event = await db.query.events.findFirst({
      where: eq(events.id, id)
    })
    if (!event) return c.json({ error: 'Event not found' }, 404)

    await db.update(events)
      .set({ views: event.views + 1 })
      .where(eq(events.id, id))

    return c.json(event)
  } catch (e) {
    return c.json({ error: 'Failed to fetch event detail' }, 500)
  }
})

// POST /api/events - Create an event
const createEventSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  date: z.coerce.date(),
  timeRange: z.string().min(1),
  venue: z.string().min(1),
  address: z.string().min(1),
  category: z.string().min(1),
  banner: z.string().optional(),
})

eventsAPI.post(
  '/',
  authMiddleware,
  zValidator('json', createEventSchema, (result, c) => {
    if (!result.success) return c.json({ error: 'Invalid input', details: result.error.issues }, 400)
  }),
  async (c) => {
    const user = c.get('user')
    if (user.role !== USER_ROLES.ORGANIZER && user.role !== USER_ROLES.ADMIN) {
      return c.json({ error: 'Forbidden. Only organizers or admins can create events.' }, 403)
    }

    const { name, description, date, timeRange, venue, address, category, banner } = c.req.valid('json')
    try {
      const [newEvent] = await db.insert(events).values({
        name,
        description,
        date,
        timeRange,
        venue,
        address,
        category,
        banner,
        organizerId: user.id
      }).returning()
      return c.json(newEvent, 201)
    } catch (e) {
      serverLogger.error('Failed to create event', { error: e })
      return c.json({ error: 'Failed to create event' }, 500)
    }
  }
)

// PUT /api/events/:id - Update an event
const updateEventSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  date: z.coerce.date().optional(),
  timeRange: z.string().optional(),
  venue: z.string().optional(),
  address: z.string().optional(),
  category: z.string().optional(),
  banner: z.string().optional(),
  status: z.enum([EVENT_STATUS.DRAFT, EVENT_STATUS.PUBLISHED, EVENT_STATUS.CANCELLED]),
})

eventsAPI.put(
  '/:id',
  authMiddleware,
  zValidator('json', updateEventSchema, (result, c) => {
    if (!result.success) return c.json({ error: 'Invalid input', details: result.error.issues }, 400)
  }),
  async (c) => {
    const id = c.req.param('id')
    const user = c.get('user')

    try {
      const event = await db.query.events.findFirst({
        where: eq(events.id, id)
      })
      if (!event) return c.json({ error: 'Event not found' }, 404)

      if (user.role !== USER_ROLES.ADMIN && event.organizerId !== user.id) {
        return c.json({ error: 'Forbidden. You do not have permission to update this event.' }, 403)
      }

      const { name, description, date, timeRange, venue, address, category, banner, status } = c.req.valid('json')
      
      const [updatedEvent] = await db.update(events)
        .set({ 
          name, 
          description, 
          date, 
          timeRange, 
          venue, 
          address, 
          category, 
          banner, 
          status,
          updatedAt: new Date() 
        })
        .where(eq(events.id, id))
        .returning()
        
      return c.json(updatedEvent)
    } catch (e) {
      return c.json({ error: 'Failed to update event' }, 500)
    }
  }
)

// DELETE /api/events/:id - Delete an event
eventsAPI.delete('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')

  try {
    const event = await db.query.events.findFirst({
      where: eq(events.id, id)
    })
    if (!event) return c.json({ error: 'Event not found' }, 404)

    if (user.role !== USER_ROLES.ADMIN && event.organizerId !== user.id) {
      return c.json({ error: 'Forbidden. You do not have permission to delete this event.' }, 403)
    }

    await db.delete(events).where(eq(events.id, id))
    return c.json({ message: 'Event deleted' })
  } catch (e) {
    return c.json({ error: 'Failed to delete event' }, 500)
  }
})

export default eventsAPI
