import { createMiddleware } from 'hono/factory';
import * as jose from 'jose';
import { db } from '../db/index.js';
import { users, blacklistedTokens } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export type Variables = {
  user: typeof users.$inferSelect;
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

    const isBlacklisted = await db.query.blacklistedTokens.findFirst({
      where: eq(blacklistedTokens.token, token)
    });

    if (isBlacklisted) {
      return c.json({ error: 'Token is invalid' }, 401);
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId)
    });

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }
    
    if (payload.tokenVersion && payload.tokenVersion !== user.tokenVersion) {
      return c.json({ error: 'Session expired due to password change' }, 401);
    }
    
    c.set('user', user);
    await next();
  } catch (e) {
    return c.json({ error: 'Invalid token' }, 401);
  }
});
