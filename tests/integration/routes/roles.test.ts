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
  const usersFindFirstMock = vi.fn();

  const updateWhereMock = vi.fn();
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  return {
    usersFindFirstMock,
    updateWhereMock,
    updateSetMock,
    updateMock,
  };
});

vi.mock('../../../src/utils/logger.js', () => ({
  serverLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../../src/db/index.js', () => ({
  db: {
    query: {
      users: {
        findFirst: mocks.usersFindFirstMock,
      },
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

import rolesRoute from '../../../src/routes/roles.js';

const createTestApp = (userOverride?: Record<string, unknown>) => {
  const app = new Hono<TestEnv>();
  app.use('/api/roles/*', async (c, next) => {
    c.set('user', {
      id: 'admin-1',
      email: 'admin@example.com',
      role: USER_ROLES.ADMIN,
      status: USER_STATUS.ACTIVE,
      ...userOverride,
    });
    await next();
  });
  app.route('/api/roles', rolesRoute);
  return app;
};

describe('Roles Routes Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usersFindFirstMock.mockResolvedValue({
      id: 'u1',
      role: USER_ROLES.USER,
    });
  });

  it('GET /api/roles returns role list', async () => {
    const app = createTestApp();

    const res = await app.request('/api/roles');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toBe('List all roles');
    expect(body.roles.ADMIN).toBe(USER_ROLES.ADMIN);
  });

  it('PUT /api/roles returns 403 for non-admin', async () => {
    const app = createTestApp({ role: USER_ROLES.USER });

    const res = await app.request('/api/roles', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'u1', role: USER_ROLES.MODERATOR }),
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('PUT /api/roles returns 404 when target user missing', async () => {
    const app = createTestApp();
    mocks.usersFindFirstMock.mockResolvedValueOnce(null);

    const res = await app.request('/api/roles', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'missing', role: USER_ROLES.MODERATOR }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'User not found' });
  });

  it('PUT /api/roles updates role successfully for admin', async () => {
    const app = createTestApp();

    const res = await app.request('/api/roles', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'u1', role: USER_ROLES.MODERATOR }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toContain('Update role user u1 to moderator');
    expect(mocks.updateMock).toHaveBeenCalled();
  });
});
