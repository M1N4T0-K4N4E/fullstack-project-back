import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { USER_ROLES, USER_STATUS } from '../../../src/constants.js';

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
  const usersFindFirstMock = vi.fn();

  const updateReturningMock = vi.fn();
  const updateWhereMock = vi.fn(() => ({ returning: updateReturningMock }));
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const verifyMock = vi.fn();
  const hashMock = vi.fn();
  const signMock = vi.fn();

  return {
    usersFindFirstMock,
    updateReturningMock,
    updateWhereMock,
    updateSetMock,
    updateMock,
    verifyMock,
    hashMock,
    signMock,
  };
});

vi.mock('../../../src/utils/logger.js', () => ({
  serverLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../../src/db/index.js', () => ({
  db: {
    update: mocks.updateMock,
    query: {
      users: {
        findFirst: mocks.usersFindFirstMock,
      },
    },
  },
}));

vi.mock('argon2', () => ({
  default: {
    verify: mocks.verifyMock,
    hash: mocks.hashMock,
  },
}));

vi.mock('jose', () => {
  class MockSignJWT {
    setProtectedHeader() { return this; }
    setIssuedAt() { return this; }
    setExpirationTime() { return this; }
    async sign() { return mocks.signMock(); }
  }

  return { SignJWT: MockSignJWT };
});

vi.mock('../../../src/middleware/auth.js', () => ({
  authMiddleware: async (c: any, next: () => Promise<void>) => {
    const existing = c.get('user');
    if (!existing) {
      c.set('user', {
        id: 'user-1',
        email: 'user-1@example.com',
        name: 'User One',
        password: 'hashed-password',
        role: USER_ROLES.USER,
        status: USER_STATUS.ACTIVE,
        avatarUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        googleId: null,
      });
    }
    await next();
  },
}));

import accountRoute from '../../../src/routes/account.js';

const createTestApp = (userOverride?: Record<string, unknown>, roleOverride?: string) => {
  const app = new Hono<TestEnv>();
  app.use('/api/account/*', async (c, next) => {
    c.set('user', {
      id: 'user-1',
      email: 'user-1@example.com',
      name: 'User One',
      password: 'hashed-password',
      role: roleOverride || USER_ROLES.USER,
      status: USER_STATUS.ACTIVE,
      avatarUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      googleId: null,
      ...userOverride,
    });
    await next();
  });
  app.route('/api/account', accountRoute);
  return app;
};

describe('Account Routes Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.updateReturningMock.mockResolvedValue([
      {
        id: 'user-1',
        email: 'user-1@example.com',
        name: 'Updated Name',
        role: USER_ROLES.USER,
      },
    ]);

    mocks.usersFindFirstMock.mockResolvedValue({
      id: 'target-user',
      role: USER_ROLES.USER,
      status: USER_STATUS.ACTIVE,
    });

    mocks.verifyMock.mockResolvedValue(true);
    mocks.hashMock.mockResolvedValue('new-hashed-password');
    mocks.signMock.mockResolvedValue('new-jwt-token');
  });

  it('GET /api/account returns safe user payload', async () => {
    const app = createTestApp();

    const res = await app.request('/api/account');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.email).toBe('user-1@example.com');
    expect(body.password).toBeUndefined();
  });

  it('PUT /api/account updates account and returns token', async () => {
    const app = createTestApp();

    const res = await app.request('/api/account', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Name' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: 'Account updated successfully', token: 'new-jwt-token' });
  });

  it('PUT /api/account updates account avatar and returns token', async () => {
    const app = createTestApp();

    const res = await app.request('/api/account', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ avatarUrl: 'https://example.com/avatar.jpg' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: 'Account updated successfully', token: 'new-jwt-token' });
  });

  it('PUT /api/account updates account return 500 on DB error', async () => {
    const app = createTestApp();
    mocks.updateReturningMock.mockRejectedValue(new Error('DB Error'));

    const res = await app.request('/api/account', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Name' }),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to update account' });
  });

  it('PUT /api/account/password returns 400 for OAuth user', async () => {
    const app = createTestApp({ password: null });

    const res = await app.request('/api/account/password', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'old', newPassword: 'password123456789' }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: 'Cannot change password for OAuth users' });
  });

  it('PUT /api/account/password returns 401 for invalid current password', async () => {
    const app = createTestApp();
    mocks.verifyMock.mockResolvedValueOnce(false);

    const res = await app.request('/api/account/password', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'password123456789' }),
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: 'Invalid current password' });
  });

  it('PUT /api/account/password returns 200 for valid password change', async () => {
    const app = createTestApp();
    mocks.verifyMock.mockResolvedValueOnce(true);
    mocks.hashMock.mockResolvedValueOnce('new-hashed-password');
    mocks.signMock.mockResolvedValueOnce('new-jwt-token');

    const res = await app.request('/api/account/password', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'password123456789' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: 'Password updated successfully', token: 'new-jwt-token' });
  });

  it('PUT /api/account/password returns 500 when DB is down', async () => {
    const app = createTestApp();
    mocks.verifyMock.mockResolvedValueOnce(true);
    mocks.hashMock.mockResolvedValueOnce('new-hashed-password');
    mocks.updateMock.mockImplementationOnce(() => {
      throw new Error('DB is down');
    });

    const res = await app.request('/api/account/password', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'correct', newPassword: 'password123456789' }),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to change password' });
  });

  it('PUT /api/account/ban returns 403 for non-admin caller', async () => {
    const app = createTestApp({ role: USER_ROLES.USER });

    const res = await app.request('/api/account/ban', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'target-user' }),
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('PUT /api/account/ban returns 403 for admin baning admin', async () => {
    const app = createTestApp({ role: USER_ROLES.ADMIN }, USER_ROLES.ADMIN);
    mocks.usersFindFirstMock.mockResolvedValueOnce({
      id: 'target-user',
      role: USER_ROLES.ADMIN,
      status: USER_STATUS.ACTIVE,
    });

    const res = await app.request('/api/account/ban', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'target-user' }),
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden. You cannot ban admin' });
  });

  it('PUT /api/account/ban bans target user for admin caller', async () => {
    const app = createTestApp({ role: USER_ROLES.ADMIN });

    const res = await app.request('/api/account/ban', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'target-user' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: 'User banned successfully' });
    expect(mocks.updateMock).toHaveBeenCalled();
  });

  it('PUT /api/account/ban can not ban non-existent user', async () => {
    const app = createTestApp({ role: USER_ROLES.ADMIN });
    mocks.usersFindFirstMock.mockResolvedValueOnce(null);

    const res = await app.request('/api/account/ban', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'target-user' }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'User not found' });
    expect(mocks.updateMock).not.toHaveBeenCalled();
  });

  it('PUT /api/account/ban admin can not ban self', async () => {
    const app = createTestApp({ role: USER_ROLES.ADMIN });
    mocks.usersFindFirstMock.mockResolvedValueOnce({
      id: 'user-1',
      role: USER_ROLES.ADMIN,
      status: USER_STATUS.ACTIVE,
    });

    const res = await app.request('/api/account/ban', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'user-1' }),
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden. You cannot ban yourself' });
    expect(mocks.updateMock).not.toHaveBeenCalled();
  });

  it('PUT /api/account/ban returns 500 on database error', async () => {
    const app = createTestApp({ role: USER_ROLES.ADMIN });
    mocks.updateMock.mockImplementationOnce(() => {
      throw new Error('DB Error');
    });

    const res = await app.request('/api/account/ban', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'user-1' }),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to ban user' });
  });
});
