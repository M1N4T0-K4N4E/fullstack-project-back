import { pgTable, text, integer, timestamp, uuid } from 'drizzle-orm/pg-core';
import { PAYMENT_STATUS, TICKET_STATUS, USER_ROLES } from '../constants.js';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  googleId: text('google_id').unique(),
  email: text('email').notNull().unique(),
  name: text('name'),
  phone: text('phone').unique(),
  role: text('role').default(USER_ROLES.USER),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(), 
  description: text('description'),
  date: timestamp('date').notNull(),
  location: text('location').notNull(),
  organizerId: uuid('organizer_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const tickets = pgTable('tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => events.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  status: text('status').default(TICKET_STATUS.PURCHASED).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
  amount: integer('amount').notNull(),
  status: text('status').default(PAYMENT_STATUS.PENDING).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

