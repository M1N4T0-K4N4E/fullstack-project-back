import { pgTable, text, integer, timestamp, uuid, jsonb, boolean } from 'drizzle-orm/pg-core';
import { PAYMENT_STATUS, TICKET_STATUS, USER_ROLES, EVENT_STATUS } from '../constants.js';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  googleId: text('google_id').unique(),
  email: text('email').notNull().unique(),
  name: text('name'),
  phone: text('phone').unique(),
  role: text('role').default(USER_ROLES.USER),
  avatarUrl: text('avatar_url'),
  password: text('password'),
  tokenVersion: integer('token_version').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(), 
  description: text('description'),
  date: timestamp('date').notNull(),
  timeRange: text('time_range').notNull(),
  venue: text('venue').notNull(),
  address: text('address').notNull(),
  organizerId: uuid('organizer_id').notNull().references(() => users.id),
  views: integer('views').default(0).notNull(),
  category: text('category').notNull(),
  banner: text('banner'),
  status: text('status').default(EVENT_STATUS.DRAFT).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const tickets = pgTable('tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => events.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  ticketType: text('ticket_type'),
  price: integer('price'),
  quantity: integer('quantity').default(1),
  status: text('status').default(TICKET_STATUS.VALID).notNull(),
  qrCode: text('qr_code').unique(),
  purchasedAt: timestamp('purchased_at').defaultNow(),
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

export const serverLogs = pgTable('server_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  level: text('level').notNull(),
  message: text('message').notNull(),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const userInteractions = pgTable('user_interactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(), // text because it can be 'guest'
  userEmail: text('user_email').notNull(),
  method: text('method').notNull(),
  path: text('path').notNull(),
  status: integer('status').notNull(),
  durationMs: integer('duration_ms').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const blacklistedTokens = pgTable('blacklisted_tokens', {
  token: text('token').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
});