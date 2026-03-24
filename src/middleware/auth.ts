import { createMiddleware } from 'hono/factory';
import * as jose from 'jose';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import redis from '../utils/redis.js';

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
      return c.json({ error: 'Invalid token' }, 401);
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId)
    });

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }
    
    c.set('user', user);
    c.set('token', token);
    c.set('payload', payload);
    await next();
  } catch (e) {
    return c.json({ error: 'Invalid token' }, 401);
  }
});

