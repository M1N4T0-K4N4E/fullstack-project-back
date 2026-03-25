import { pgTable, text, integer, timestamp, uuid, jsonb, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { init } from '@paralleldrive/cuid2';
import { USER_ROLES, USER_STATUS } from '../constants.js';

const createId = init({
  random: Math.random,
  length: 10,
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  googleId: text('google_id').unique(),
  email: text('email').notNull().unique(),
  password: text('password'),
  name: text('name').notNull(),
  role: text('role').notNull().default(USER_ROLES.USER),
  avatarUrl: text('avatar_url'),
  status: text('status').notNull().default(USER_STATUS.ACTIVE),
  timeoutEnd: timestamp('timeout_end'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const posts = pgTable('posts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: uuid('user_id').notNull().references(() => users.id),
  title: text('title').notNull(), 
  context: text('context'),
  thumbnail: text('thumbnail'),
  like: integer('like').default(0).notNull(),
  dislike: integer('dislike').default(0).notNull(),
  isPublic: boolean('is_public').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),

});

export const postLikes = pgTable('post_likes', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: uuid('user_id').notNull().references(() => users.id),
  postId: text('post_id').notNull().references(() => posts.id),
  createdAt: timestamp('created_at').defaultNow(),
});

export const postDislikes = pgTable('post_dislikes', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: uuid('user_id').notNull().references(() => users.id),
  postId: text('post_id').notNull().references(() => posts.id),
  createdAt: timestamp('created_at').defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one }) => ({
  user: one(users, {
    fields: [posts.userId],
    references: [users.id],
  }),
}));

export const serverLogs = pgTable('server_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  level: text('level').notNull(),
  message: text('message').notNull(),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const userInteractions = pgTable('user_interactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(), // can be 'guest'
  userEmail: text('user_email').notNull(),
  method: text('method').notNull(),
  path: text('path').notNull(),
  status: integer('status').notNull(),
  durationMs: integer('duration_ms').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow(),
});