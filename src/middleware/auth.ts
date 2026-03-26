import { createMiddleware } from 'hono/factory';
import * as jose from 'jose';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import redis from '../utils/redis.js';
import { USER_STATUS } from '../constants.js';
import { serverLogger } from '../utils/logger.js';

export type Variables = {
  user: typeof users.$inferSelect;
  token: string;
  payload: jose.JWTPayload;
};

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

export const authMiddleware = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Accept both "Bearer <token>" and plain "<token>"
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  try {
    const { payload } = await jose.jwtVerify(token, secret);
    const userId = payload.sub as string;

    if (!userId) {
      return c.json({ error: 'Invalid token' }, 401);
    }

    const isBlacklisted = await redis.get(token);

    if (isBlacklisted) {
      serverLogger.error('Invalid token, blacklisted', { token });
      return c.json({ error: 'Invalid token' }, 401);
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId)
    });

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const isBanned = user.status == USER_STATUS.BANNED;
    if (isBanned) {
      return c.json({ error: 'Forbidden. You are banned.' }, 403);
    }

    // timeout status replace
    if (user.timeoutEnd && user.timeoutEnd <= new Date()) {
      await db.update(users)
        .set({
          status: USER_STATUS.ACTIVE,
          timeoutEnd: null,
        })
        .where(eq(users.id, userId))
    }

    c.set('user', user);
    c.set('token', token);
    c.set('payload', payload);
    await next();
  } catch (e) {
    return c.json({ error: 'Invalid token' }, 401);
  }
});

export const authGuestMiddleware = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return next();
  }

  // Accept both "Bearer <token>" and plain "<token>"
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  try {
    const { payload } = await jose.jwtVerify(token, secret);
    const userId = payload.sub as string;

    if (!userId) {
      return next();
    }

    const isBlacklisted = await redis.get(token);

    if (isBlacklisted) {
      serverLogger.error('Invalid token, blacklisted', { token });
      return c.json({ error: 'Invalid token' }, 401);
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId)
    });

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const isBanned = user.status == USER_STATUS.BANNED;
    if (isBanned) {
      return c.json({ error: 'Forbidden. You are banned.' }, 403);
    }

    // timeout status replace
    if (user.timeoutEnd && user.timeoutEnd <= new Date()) {
      await db.update(users)
        .set({
          status: USER_STATUS.ACTIVE,
          timeoutEnd: null,
        })
        .where(eq(users.id, userId))
    }

    c.set('user', user);
    c.set('token', token);
    c.set('payload', payload);
    await next();
  } catch (e) {
    return next();
  }
});

export const authAdminMiddleware = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Accept both "Bearer <token>" and plain "<token>"
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  try {
    const { payload } = await jose.jwtVerify(token, secret);
    const userId = payload.sub as string;

    if (!userId) {
      return c.json({ error: 'Invalid token' }, 401);
    }

    const isBlacklisted = await redis.get(token);

    if (isBlacklisted) {
      serverLogger.error('Invalid token, blacklisted', { token });
      return c.json({ error: 'Invalid token' }, 401);
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId)
    });

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const isBanned = user.status == USER_STATUS.BANNED;
    if (isBanned) {
      return c.json({ error: 'Forbidden. You are banned.' }, 403);
    }

    // timeout status replace
    if (user.timeoutEnd && user.timeoutEnd <= new Date()) {
      await db.update(users)
        .set({
          status: USER_STATUS.ACTIVE,
          timeoutEnd: null,
        })
        .where(eq(users.id, userId))
    }

    c.set('user', user);
    c.set('token', token);
    c.set('payload', payload);
    await next();
  } catch (e) {
    serverLogger.error('Error occurred while verifying token', { error: e });
    return c.json({ error: 'Invalid token' }, 401);
  }
});