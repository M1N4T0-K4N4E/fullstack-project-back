import { Hono } from 'hono'
import { db } from '../db/index.js'
import { tickets, events } from '../db/schema.js'
import { eq, or } from 'drizzle-orm'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware } from '../middleware/auth.js'
import type { Variables } from '../middleware/auth.js'
import { USER_ROLES, TICKET_STATUS } from '../constants.js'

const ticketsAPI = new Hono<{ Variables: Variables }>()

ticketsAPI.use('/*', authMiddleware)

// GET /api/tickets - List tickets based on role
ticketsAPI.get('/', async (c) => {
  const user = c.get('user')
  
  try {
    const query = db.select({
      ticket: tickets,
      event: events
    })
    .from(tickets)
    .innerJoin(events, eq(tickets.eventId, events.id))

    if (user.role === USER_ROLES.ADMIN) {
      // Admin sees all
      const allTickets = await query;
      return c.json(allTickets);
    } else if (user.role === USER_ROLES.ORGANIZER) {
      // Organizer sees their own purchased tickets + tickets for events they organize
      const orgTickets = await query.where(
        or(
          eq(tickets.userId, user.id),
          eq(events.organizerId, user.id)
        )
      );
      return c.json(orgTickets);
    } else {
      // Regular user sees only their own tickets
      const userTickets = await query.where(eq(tickets.userId, user.id));
      return c.json(userTickets);
    }
  } catch (e) {
    return c.json({ error: 'Failed to fetch tickets' }, 500)
  }
})

// GET /api/tickets/:id - Ticket detail
ticketsAPI.get('/:id', async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')

  try {
    const [result] = await db.select({
      ticket: tickets,
      event: events
    })
    .from(tickets)
    .innerJoin(events, eq(tickets.eventId, events.id))
    .where(eq(tickets.id, id))

    if (!result) return c.json({ error: 'Ticket not found' }, 404)

    // Check permissions
    if (
      user.role !== USER_ROLES.ADMIN &&
      result.ticket.userId !== user.id &&
      result.event.organizerId !== user.id
    ) {
      return c.json({ error: 'Forbidden. You do not have permission to view this ticket.' }, 403)
    }

    return c.json(result)
  } catch (e) {
    return c.json({ error: 'Failed to fetch ticket detail' }, 500)
  }
})

// POST /api/tickets - Buy a ticket
const buyTicketSchema = z.object({
  eventId: z.uuid()
})

ticketsAPI.post(
  '/',
  zValidator('json', buyTicketSchema, (result, c) => {
    if (!result.success) return c.json({ error: 'Invalid input', details: result.error.issues }, 400)
  }),
  async (c) => {
    const user = c.get('user')
    const { eventId } = c.req.valid('json')

    try {
      const event = await db.query.events.findFirst({
        where: eq(events.id, eventId)
      })
      if (!event) return c.json({ error: 'Event not found' }, 404)

      const [newTicket] = await db.insert(tickets).values({
        userId: user.id,
        eventId,
        status: TICKET_STATUS.PURCHASED
      }).returning()
      
      return c.json(newTicket, 201)
    } catch (e) {
      return c.json({ error: 'Failed to buy ticket' }, 500)
    }
  }
)

// DELETE /api/tickets/:id - Cancel/Refund ticket
ticketsAPI.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')

  try {
    const [result] = await db.select({
      ticket: tickets,
      event: events
    })
    .from(tickets)
    .innerJoin(events, eq(tickets.eventId, events.id))
    .where(eq(tickets.id, id))

    if (!result) return c.json({ error: 'Ticket not found' }, 404)

    // Check permissions
    if (
      user.role !== USER_ROLES.ADMIN &&
      result.ticket.userId !== user.id &&
      result.event.organizerId !== user.id
    ) {
      return c.json({ error: 'Forbidden. You do not have permission to cancel this ticket.' }, 403)
    }

    const [updatedTicket] = await db.update(tickets)
      .set({ 
        status: TICKET_STATUS.CANCELLED,
        updatedAt: new Date()
      })
      .where(eq(tickets.id, id))
      .returning()

    return c.json({ message: 'Ticket cancelled', ticket: updatedTicket })
  } catch (e) {
    return c.json({ error: 'Failed to cancel ticket' }, 500)
  }
})

export default ticketsAPI
