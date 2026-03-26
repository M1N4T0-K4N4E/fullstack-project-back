import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { USER_STATUS } from '../../../src/constants.js';

type TestUser = {
  id: string;
  email: string;
  name?: string | null;
  password?: string | null;
  role: string;
  status: string;
  avatarUrl?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  googleId?: string | null;
};

type TestEnv = {
  Variables: {
    user: TestUser;
  };
};

const mocks = vi.hoisted(() => {
  const jwtVerifyMock = vi.fn();
  const redisGetMock = vi.fn();
  const userFindFirstMock = vi.fn();

  const updateWhereMock = vi.fn();
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  return {
    jwtVerifyMock,
    redisGetMock,
    userFindFirstMock,
    updateWhereMock,
    updateSetMock,
    updateMock,
  };
});

vi.mock('jose', () => ({
  jwtVerify: mocks.jwtVerifyMock,
}));

vi.mock('../../../src/utils/redis.js', () => ({
  default: {
    get: mocks.redisGetMock,
  },
}));

vi.mock('../../../src/db/index.js', () => ({
  db: {
    query: {
      users: {
        findFirst: mocks.userFindFirstMock,
      },
    },
    update: mocks.updateMock,
  },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  serverLogger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { authAdminMiddleware, authGuestMiddleware, authMiddleware } from '../../../src/middleware/auth.js';

const buildApp = (middleware: any) => {
  const app = new Hono<TestEnv>();
  app.use('/protected', middleware);
  app.get('/protected', (c) => {
    const user = c.get('user');
    return c.json({ ok: true, userId: user?.id ?? null }, 200);
  });
  return app;
};

describe('Auth Middleware (real module)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'user-1' },
    });
    mocks.redisGetMock.mockResolvedValue(null);
    mocks.userFindFirstMock.mockResolvedValue({
      id: 'user-1',
      email: 'user-1@example.com',
      role: 'user',
      status: USER_STATUS.ACTIVE,
      timeoutEnd: null,
    });
  });

  it('returns 401 when Authorization header is missing', async () => {
    const app = buildApp(authMiddleware);
    const res = await app.request('/protected');
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('allows guest middleware when Authorization is missing', async () => {
    const app = buildApp(authGuestMiddleware);
    const res = await app.request('/protected');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, userId: null });
  });

  it('returns 401 when token is blacklisted', async () => {
    const app = buildApp(authMiddleware);
    mocks.redisGetMock.mockResolvedValueOnce('1');

    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer blacklisted-token' },
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: 'Invalid token' });
  });

  it('returns 404 when user is not found', async () => {
    const app = buildApp(authMiddleware);
    mocks.userFindFirstMock.mockResolvedValueOnce(null);

    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer valid-token' },
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'User not found' });
  });

  it('returns 403 when user is banned', async () => {
    const app = buildApp(authMiddleware);
    mocks.userFindFirstMock.mockResolvedValueOnce({
      id: 'user-1',
      role: 'user',
      status: USER_STATUS.BANNED,
      timeoutEnd: null,
    });

    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer valid-token' },
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden. You are banned.' });
  });

  it('returns 403 in admin middleware for non-admin/moderator', async () => {
    const app = buildApp(authAdminMiddleware);
    mocks.userFindFirstMock.mockResolvedValueOnce({
      id: 'user-1',
      role: 'user',
      status: USER_STATUS.ACTIVE,
      timeoutEnd: null,
    });

    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer valid-token' },
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden. Moderator or Admin only.' });
  });

  it('refreshes expired timeout and allows request', async () => {
    const app = buildApp(authMiddleware);
    const timedOutUser = {
      id: 'user-1',
      role: 'user',
      status: USER_STATUS.TIMEOUT,
      timeoutEnd: new Date(Date.now() - 1000),
    };
    mocks.userFindFirstMock.mockResolvedValueOnce(timedOutUser).mockResolvedValueOnce(timedOutUser);

    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer valid-token' },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, userId: 'user-1' });
    expect(mocks.updateMock).toHaveBeenCalled();
  });

  it('returns 401 when jwtVerify throws', async () => {
    const app = buildApp(authMiddleware);
    mocks.jwtVerifyMock.mockRejectedValueOnce(new Error('bad token'));

    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer invalid-token' },
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: 'Invalid token' });
  });
});

