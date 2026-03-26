import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { USER_ROLES, USER_STATUS } from '../../../src/constants.js';

const mocks = vi.hoisted(() => {
  const usersFindFirstMock = vi.fn();
  const insertReturningMock = vi.fn();
  const insertValuesMock = vi.fn(() => ({ returning: insertReturningMock }));
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const redisSetMock = vi.fn();
  const redisGetMock = vi.fn();
  const redisDelMock = vi.fn();

  const hashMock = vi.fn();
  const verifyMock = vi.fn();

  const jwtVerifyMock = vi.fn();

  const uuidMock = vi.fn();

  const signMock = vi.fn();

  return {
    usersFindFirstMock,
    insertReturningMock,
    insertValuesMock,
    insertMock,
    redisSetMock,
    redisGetMock,
    redisDelMock,
    hashMock,
    verifyMock,
    jwtVerifyMock,
    uuidMock,
    signMock,
  };
});

vi.mock('../../../src/utils/logger.js', () => ({
  serverLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../../src/db/index.js', () => ({
  db: {
    insert: mocks.insertMock,
    query: {
      users: {
        findFirst: mocks.usersFindFirstMock,
      },
    },
  },
}));

vi.mock('../../../src/utils/redis.js', () => ({
  default: {
    set: mocks.redisSetMock,
    get: mocks.redisGetMock,
    del: mocks.redisDelMock,
  },
}));

vi.mock('argon2', () => ({
  default: {
    hash: mocks.hashMock,
    verify: mocks.verifyMock,
  },
}));

vi.mock('uuid', () => ({
  v4: mocks.uuidMock,
}));

vi.mock('jose', () => {
  class MockSignJWT {
    payload: any;
    constructor(payload: any) {
      this.payload = payload;
    }
    setProtectedHeader() {
      return this;
    }
    setIssuedAt() {
      return this;
    }
    setExpirationTime() {
      return this;
    }
    async sign() {
      return mocks.signMock(this.payload);
    }
  }

  return {
    SignJWT: MockSignJWT,
    jwtVerify: mocks.jwtVerifyMock,
  };
});

vi.mock('arctic', () => {
  class MockGoogle {
    createAuthorizationURL() {
      return new URL('https://accounts.google.com/o/oauth2/v2/auth');
    }
    async validateAuthorizationCode() {
      return {
        accessToken: () => 'google-access-token',
      };
    }
  }

  return {
    Google: MockGoogle,
    generateState: () => 'mock-state',
    generateCodeVerifier: () => 'mock-code-verifier',
  };
});

vi.mock('../../../src/middleware/auth.js', () => ({
  authMiddleware: async (c: any, next: () => Promise<void>) => {
    c.set('user', {
      id: 'user-1',
      email: 'user-1@example.com',
      name: 'User One',
      role: USER_ROLES.USER,
      status: USER_STATUS.ACTIVE,
    });
    c.set('token', 'access-token-for-logout');
    await next();
  },
}));

import authRoute from '../../../src/routes/auth.js';

const createTestApp = () => {
  const app = new Hono();
  app.route('/api/auth', authRoute);
  return app;
};

const fetchMock = vi.fn();

describe('Auth Routes Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);

    process.env.FRONTEND_URL = 'http://localhost:3000';

    mocks.usersFindFirstMock.mockReset();
    mocks.insertReturningMock.mockReset();
    mocks.insertValuesMock.mockReset();
    mocks.insertMock.mockReset();
    mocks.redisSetMock.mockReset();
    mocks.redisGetMock.mockReset();
    mocks.redisDelMock.mockReset();
    mocks.hashMock.mockReset();
    mocks.verifyMock.mockReset();
    mocks.jwtVerifyMock.mockReset();
    mocks.uuidMock.mockReset();
    mocks.signMock.mockReset();

    mocks.insertValuesMock.mockImplementation(() => ({ returning: mocks.insertReturningMock }));
    mocks.insertMock.mockImplementation(() => ({ values: mocks.insertValuesMock }));

    mocks.usersFindFirstMock.mockResolvedValue(null);
    mocks.insertReturningMock.mockResolvedValue([
      {
        id: 'user-1',
        email: 'user-1@example.com',
        name: 'User One',
        role: USER_ROLES.USER,
      },
    ]);

    mocks.redisSetMock.mockResolvedValue('OK');
    mocks.redisGetMock.mockResolvedValue('user-1');
    mocks.redisDelMock.mockResolvedValue(1);

    mocks.hashMock.mockResolvedValue('hashed-password');
    mocks.verifyMock.mockResolvedValue(true);

    mocks.uuidMock.mockReturnValue('jti-1');
    mocks.signMock.mockImplementation((payload: any) =>
      payload?.jti ? 'refresh-token-signed' : 'access-token-signed'
    );

    mocks.jwtVerifyMock.mockResolvedValue({
      payload: {
        sub: 'user-1',
        jti: 'jti-1',
      },
    });

    fetchMock.mockResolvedValue({
      json: async () => ({
        sub: 'google-sub-1',
        email: 'google@example.com',
        name: 'Google User',
        picture: 'https://example.com/avatar.png',
      }),
    });
  });

  it('POST /api/auth/register returns 201 for new user', async () => {
    const app = createTestApp();

    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'user-1@example.com',
        password: 'password123456789',
        name: 'User One',
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({
      message: 'User registered successfully',
      token: 'access-token-signed',
      refreshToken: 'refresh-token-signed',
    });
    expect(mocks.hashMock).toHaveBeenCalled();
    expect(mocks.insertMock).toHaveBeenCalled();
    expect(mocks.redisSetMock).toHaveBeenCalled();
  });

  it('POST /api/auth/register returns 400 when user exists', async () => {
    const app = createTestApp();

    mocks.usersFindFirstMock.mockResolvedValueOnce({
      id: 'existing-user',
      email: 'user-1@example.com',
    });

    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'user-1@example.com',
        password: 'password123456789',
        name: 'User One',
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: 'User already exists' });
  });

  it('POST /api/auth/login returns 401 when user is unknown', async () => {
    const app = createTestApp();

    mocks.usersFindFirstMock.mockResolvedValueOnce(null);

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'unknown@example.com',
        password: 'password123',
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: 'Invalid credentials' });
  });

  it('POST /api/auth/login returns 401 for OAuth-only user', async () => {
    const app = createTestApp();

    mocks.usersFindFirstMock.mockResolvedValueOnce({
      id: 'oauth-user',
      email: 'oauth@example.com',
      password: null,
      name: 'OAuth User',
      role: USER_ROLES.USER,
    });

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'oauth@example.com',
        password: 'password123',
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: 'User registered with OAuth. Please login with Google.' });
  });

  it('POST /api/auth/login returns 401 for invalid password', async () => {
    const app = createTestApp();

    mocks.usersFindFirstMock.mockResolvedValueOnce({
      id: 'user-1',
      email: 'user-1@example.com',
      password: 'hashed-password',
      name: 'User One',
      role: USER_ROLES.USER,
    });
    mocks.verifyMock.mockResolvedValueOnce(false);

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'user-1@example.com',
        password: 'bad-password',
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: 'Invalid credentials' });
  });

  it('POST /api/auth/login returns 200 for valid credentials', async () => {
    const app = createTestApp();

    mocks.usersFindFirstMock.mockResolvedValueOnce({
      id: 'user-1',
      email: 'user-1@example.com',
      password: 'hashed-password',
      name: 'User One',
      role: USER_ROLES.USER,
    });
    mocks.verifyMock.mockResolvedValueOnce(true);

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'user-1@example.com',
        password: 'password123',
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      message: 'Login successful',
      token: 'access-token-signed',
      refreshToken: 'refresh-token-signed',
    });
  });

  it('GET /api/auth/google redirects to Google OAuth URL and sets cookies', async () => {
    const app = createTestApp();

    const res = await app.request('/api/auth/google');

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('accounts.google.com');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('google_oauth_state=mock-state');
    expect(setCookie).toContain('google_code_verifier=mock-code-verifier');
  });

  it('GET /api/auth/google/callback returns 400 for invalid state/verifier', async () => {
    const app = createTestApp();

    const res = await app.request('/api/auth/google/callback?code=auth-code&state=wrong-state', {
      headers: {
        Cookie: 'google_oauth_state=mock-state; google_code_verifier=mock-code-verifier',
      },
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid state or code' });
  });

  it('GET /api/auth/google/callback redirects existing Google user with tokens', async () => {
    const app = createTestApp();

    mocks.usersFindFirstMock.mockResolvedValueOnce({
      id: 'user-google-1',
      email: 'google@example.com',
      name: 'Google User',
      role: USER_ROLES.USER,
    });

    const res = await app.request('/api/auth/google/callback?code=auth-code&state=mock-state', {
      headers: {
        Cookie: 'google_oauth_state=mock-state; google_code_verifier=mock-code-verifier',
      },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/auth-success?token=access-token-signed&refreshToken=refresh-token-signed',
    );
    expect(mocks.insertMock).not.toHaveBeenCalled();
  });

  it('GET /api/auth/google/callback creates new Google user and redirects with tokens', async () => {
    const app = createTestApp();

    mocks.usersFindFirstMock.mockResolvedValueOnce(null);
    mocks.insertReturningMock.mockResolvedValueOnce([
      {
        id: 'new-google-user',
        email: 'google@example.com',
        name: 'Google User',
        role: USER_ROLES.USER,
      },
    ]);

    const res = await app.request('/api/auth/google/callback?code=auth-code&state=mock-state', {
      headers: {
        Cookie: 'google_oauth_state=mock-state; google_code_verifier=mock-code-verifier',
      },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/auth-success?token=access-token-signed&refreshToken=refresh-token-signed',
    );
    expect(mocks.insertMock).toHaveBeenCalled();
  });

  it('GET /api/auth/me returns authenticated user', async () => {
    const app = createTestApp();

    const res = await app.request('/api/auth/me');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      id: 'user-1',
      email: 'user-1@example.com',
    });
  });

  it('POST /api/auth/logout blacklists access token and removes refresh token', async () => {
    const app = createTestApp();

    mocks.jwtVerifyMock.mockResolvedValueOnce({ payload: { sub: 'user-1', jti: 'jti-1' } });

    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'refresh-token-signed' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: 'Logged out successfully' });
    expect(mocks.redisSetMock).toHaveBeenCalledWith('access-token-for-logout', 'true', 'EX', 15 * 60);
    expect(mocks.redisDelMock).toHaveBeenCalledWith('refresh_token:jti-1');
  });

  it('POST /api/auth/refresh returns 200 with a new access token', async () => {
    const app = createTestApp();

    mocks.jwtVerifyMock.mockResolvedValueOnce({ payload: { sub: 'user-1', jti: 'jti-1' } });
    mocks.redisGetMock.mockResolvedValueOnce('user-1');
    mocks.usersFindFirstMock.mockResolvedValueOnce({
      id: 'user-1',
      email: 'user-1@example.com',
      name: 'User One',
      role: USER_ROLES.USER,
    });

    const res = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'refresh-token-signed' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      message: 'Token refreshed successfully',
      token: 'access-token-signed',
    });
  });

  it('POST /api/auth/refresh returns 401 for invalid token payload', async () => {
    const app = createTestApp();

    mocks.jwtVerifyMock.mockResolvedValueOnce({ payload: { sub: 'user-1' } });

    const res = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'refresh-token-signed' }),
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: 'Invalid refresh token' });
  });

  it('POST /api/auth/refresh returns 401 for expired/unknown redis token', async () => {
    const app = createTestApp();

    mocks.jwtVerifyMock.mockResolvedValueOnce({ payload: { sub: 'user-1', jti: 'jti-1' } });
    mocks.redisGetMock.mockResolvedValueOnce(null);

    const res = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'refresh-token-signed' }),
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: 'Refresh token expired or invalid' });
  });

  it('POST /api/auth/refresh returns 404 when user is missing', async () => {
    const app = createTestApp();

    mocks.jwtVerifyMock.mockResolvedValueOnce({ payload: { sub: 'user-1', jti: 'jti-1' } });
    mocks.redisGetMock.mockResolvedValueOnce('user-1');
    mocks.usersFindFirstMock.mockResolvedValueOnce(null);

    const res = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'refresh-token-signed' }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'User not found' });
  });

  it('POST /api/auth/refresh returns 401 when refresh token is expired or invalid JWT', async () => {
    const app = createTestApp();

    mocks.jwtVerifyMock.mockRejectedValueOnce(new Error('jwt expired'));

    const res = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'expired-or-invalid-token' }),
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: 'Invalid refresh token' });
  });
});
