import { createMiddleware } from 'hono/factory';
import { type Context } from 'hono';
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

type AuthMiddlewareOptions = {
  optional?: boolean;
  moderatorOrAdmin?: boolean;
};

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

const extractToken = (authHeader: string): string => {
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
};

const setAuthContext = (
  c: Context<{ Variables: Variables }>,
  user: typeof users.$inferSelect,
  token: string,
  payload: jose.JWTPayload,
) => {
  c.set('user', user);
  c.set('token', token);
  c.set('payload', payload);
};

const createAuthMiddleware = ({ optional = false, moderatorOrAdmin = false }: AuthMiddlewareOptions = {}) =>
  createMiddleware<{ Variables: Variables }>(async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      if (optional) {
        return next();
      }
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const token = extractToken(authHeader);

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
        where: eq(users.id, userId),
      });

      if (!user) {
        return c.json({ error: 'User not found' }, 404);
      }

      const isBanned = user.status == USER_STATUS.BANNED;
      if (isBanned) {
        return c.json({ error: 'Forbidden. You are banned.' }, 403);
      }

      if (moderatorOrAdmin) {
        if (user.role !== 'admin' && user.role !== 'moderator') {
          return c.json({ error: 'Forbidden. Moderator or Admin only.' }, 403);
        }
      }

      if (user.timeoutEnd && user.timeoutEnd <= new Date()) {
        await db.update(users)
          .set({
            status: USER_STATUS.ACTIVE,
            timeoutEnd: null,
          })
          .where(eq(users.id, userId));
      }

      setAuthContext(c, user, token, payload);
      await next();
    } catch (e) {
      if (optional) {
        return next();
      }
      serverLogger.error('Error occurred while verifying token', { error: e });
      return c.json({ error: 'Invalid token' }, 401);
    }
  });

export const authMiddleware = createAuthMiddleware();

export const authGuestMiddleware = createAuthMiddleware({ optional: true });

export const authAdminMiddleware = createAuthMiddleware({ moderatorOrAdmin: true });