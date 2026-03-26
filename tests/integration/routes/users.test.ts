import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { USER_ROLES, USER_STATUS } from '../../../src/constants.js';

type TestUser = {
  id: string;
  email: string;
  role: string;
  status: string;
};

type TestEnv = {
  Variables: {
    user: TestUser;
  };
};

const mocks = vi.hoisted(() => {
  const selectMock = vi.fn();
  const selectFromMock = vi.fn();
  const selectWhereMock = vi.fn();

  const updateReturningMock = vi.fn();
  const updateWhereMock = vi.fn(() => ({ returning: updateReturningMock }));
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const countValue = { value: 2 };
  const listValue = { value: [] as any[] };
  const byIdValue = { value: [] as any[] };

  return {
    selectMock,
    selectFromMock,
    selectWhereMock,
    updateReturningMock,
    updateWhereMock,
    updateSetMock,
    updateMock,
    countValue,
    listValue,
    byIdValue,
  };
});

vi.mock('../../../src/utils/logger.js', () => ({
  serverLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../../src/db/index.js', () => ({
  db: {
    select: (...args: any[]) => {
      const firstArg = args[0] ?? {};
      if (firstArg.count) {
        return {
          from: () => Promise.resolve([{ count: mocks.countValue.value }]),
        };
      }

      return {
        from: () => ({
          orderBy: () => ({
            limit: () => ({
              offset: () => Promise.resolve(mocks.listValue.value),
            }),
          }),
          where: () => Promise.resolve(mocks.byIdValue.value),
        }),
      };
    },
    update: mocks.updateMock,
  },
}));

vi.mock('../../../src/middleware/auth.js', () => ({
  authMiddleware: async (c: any, next: () => Promise<void>) => {
    const existing = c.get('user');
    if (!existing) {
      c.set('user', {
        id: 'admin-1',
        email: 'admin@example.com',
        role: USER_ROLES.ADMIN,
        status: USER_STATUS.ACTIVE,
      });
    }
    await next();
  },
}));

import usersRoute from '../../../src/routes/users.js';

const createTestApp = (userOverride?: Record<string, unknown>) => {
  const app = new Hono<TestEnv>();
  app.use('/api/users/*', async (c, next) => {
    c.set('user', {
      id: 'admin-1',
      email: 'admin@example.com',
      role: USER_ROLES.ADMIN,
      status: USER_STATUS.ACTIVE,
      ...userOverride,
    });
    await next();
  });
  app.route('/api/users', usersRoute);
  return app;
};

describe('Users Routes Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.countValue.value = 2;
    mocks.listValue.value = [
      { id: 'u1', email: 'a@example.com', role: USER_ROLES.USER, status: USER_STATUS.ACTIVE },
      { id: 'u2', email: 'b@example.com', role: USER_ROLES.USER, status: USER_STATUS.ACTIVE },
    ];
    mocks.byIdValue.value = [];

    mocks.updateReturningMock.mockResolvedValue([
      { id: 'u1', role: USER_ROLES.USER, status: USER_STATUS.TIMEOUT },
    ]);
  });

  it('GET /api/users returns 403 for non-admin/moderator', async () => {
    const app = createTestApp({ role: USER_ROLES.USER });

    const res = await app.request('/api/users');
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden. ' });
  });

  it('GET /api/users returns paginated users for admin', async () => {
    const app = createTestApp();

    const res = await app.request('/api/users?page=1&limit=10');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.data.length).toBe(2);
  });

  it('GET /api/users/:id returns 404 when missing', async () => {
    const app = createTestApp();
    mocks.byIdValue.value = [];

    const res = await app.request('/api/users/u404');
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'User not found' });
  });

  it('GET /api/users/:id returns user when found', async () => {
    const app = createTestApp();
    mocks.byIdValue.value = [{ id: 'u1', email: 'a@example.com', role: USER_ROLES.USER }];

    const res = await app.request('/api/users/u1');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toBe('User fetched successfully');
  });

  it('POST /api/users/timeout/:id returns 403 when target is moderator', async () => {
    const app = createTestApp();
    mocks.byIdValue.value = [{ id: 'mod-1', role: USER_ROLES.MODERATOR }];

    const res = await app.request('/api/users/timeout/mod-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ duration: 2 }),
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden. You cannot timeout admin or moderator' });
  });

  it('POST /api/users/timeout/:id timeouts user successfully', async () => {
    const app = createTestApp();
    mocks.byIdValue.value = [{ id: 'u1', role: USER_ROLES.USER }];

    const res = await app.request('/api/users/timeout/u1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ duration: 2 }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toBe('Timeout user successfully');
  });
});
