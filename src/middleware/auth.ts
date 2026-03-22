import { createMiddleware } from 'hono/factory';
import * as jose from 'jose';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export type Variables = {
  user: typeof users.$inferSelect;
};

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

export const authMiddleware = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.split(' ')[1];

  try {
    const { payload } = await jose.jwtVerify(token, secret);
    const userId = payload.sub as string;
    
    if (!userId) {
      return c.json({ error: 'Invalid token' }, 401);
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId)
    });

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }
    
    c.set('user', user);
    await next();
  } catch (e) {
    return c.json({ error: 'Invalid token' }, 401);
  }
});
