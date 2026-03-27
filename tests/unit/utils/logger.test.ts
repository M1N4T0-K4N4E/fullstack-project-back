import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

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
  const insertValuesMock = vi.fn().mockResolvedValue(undefined);
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));
  return { insertMock, insertValuesMock };
});

vi.mock('../../../src/db/index.js', () => ({
  db: {
    insert: mocks.insertMock,
  },
}));

import { serverLogger, userInteractionLogger, userLogger } from '../../../src/utils/logger.js';

describe('Logger Utils (real module)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports configured logger instances', () => {
    expect(serverLogger).toBeDefined();
    expect(userLogger).toBeDefined();
    expect(typeof serverLogger.info).toBe('function');
    expect(typeof userLogger.error).toBe('function');
  });

  it('logs user interaction with inferred LOGIN action', async () => {
    const app = new Hono();
    app.use('*', userInteractionLogger);
    app.post('/api/auth/login', (c) => c.json({ ok: true }, 200));

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'user-agent': 'vitest-agent',
      },
    });

    expect(res.status).toBe(200);
    expect(mocks.insertMock).toHaveBeenCalled();
    expect(mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'login',
        method: 'POST',
        path: '/api/auth/login',
      }),
    );
  });

  it('normalizes trailing slashes and still infers LOGIN action', async () => {
    const app = new Hono();
    app.use('*', userInteractionLogger);
    app.post('/api/auth/login/*', (c) => c.json({ ok: true }, 200));

    const res = await app.request('/api/auth/login///', {
      method: 'POST',
      headers: {
        'user-agent': 'vitest-agent',
      },
    });

    expect(res.status).toBe(200);
    expect(mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'login',
        method: 'POST',
        path: '/api/auth/login///',
      }),
    );
  });

  it('logs user interaction with UNKNOWN action for unmapped route', async () => {
    const app = new Hono();
    app.use('*', userInteractionLogger);
    app.get('/api/random', (c) => c.json({ ok: true }, 200));

    const res = await app.request('/api/random', { method: 'GET' });

    expect(res.status).toBe(200);
    expect(mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'unknown',
        method: 'GET',
        path: '/api/random',
      }),
    );
  });

  it('normalizes trailing slashes and infers CHANGE_PASSWORD action', async () => {
    const app = new Hono();
    app.use('*', userInteractionLogger);
    app.put('/api/account/password/*', (c) => c.json({ ok: true }, 200));

    const res = await app.request('/api/account/password//', {
      method: 'PUT',
    });

    expect(res.status).toBe(200);
    expect(mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'change_password',
        method: 'PUT',
        path: '/api/account/password//',
      }),
    );
  });

  it('uses guest identity fields when request is unauthenticated', async () => {
    const app = new Hono();
    app.use('*', userInteractionLogger);
    app.get('/api/public', (c) => c.json({ ok: true }, 200));

    const res = await app.request('/api/public', {
      method: 'GET',
      headers: {
        'user-agent': 'vitest-agent',
      },
    });

    expect(res.status).toBe(200);
    expect(mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'guest',
        userEmail: 'guest',
        userRole: 'guest',
        method: 'GET',
        path: '/api/public',
      }),
    );
  });

  it('uses authenticated identity fields when user exists in context', async () => {
    const app = new Hono<TestEnv>();
    app.use(async (c, next) => {
      c.set('user', {
        id: 'user-123',
        email: 'user-123@example.com',
        role: 'admin',
        status: 'active',
      });

      await next();
    });
    app.use('*', userInteractionLogger);
    app.get('/api/private', (c) => c.json({ ok: true }, 200));

    const res = await app.request('/api/private', {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    expect(mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-123',
        userEmail: 'user-123@example.com',
        userRole: 'admin',
        method: 'GET',
        path: '/api/private',
      }),
    );
  });

  it('uses error logger branch when response status is >= 400', async () => {
    const app = new Hono();
    const errorSpy = vi.spyOn(userLogger, 'error');
    const infoSpy = vi.spyOn(userLogger, 'info');

    app.use('*', userInteractionLogger);
    app.get('/api/fail', (c) => c.json({ error: 'boom' }, 500));

    const res = await app.request('/api/fail', { method: 'GET' });

    expect(res.status).toBe(500);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'unknown',
        method: 'GET',
        path: '/api/fail',
        status: 500,
      }),
    );
  });

  it('uses info logger branch when response status is < 400', async () => {
    const app = new Hono();
    const errorSpy = vi.spyOn(userLogger, 'error');
    const infoSpy = vi.spyOn(userLogger, 'info');

    app.use('*', userInteractionLogger);
    app.get('/api/success', (c) => c.json({ ok: true }, 200));

    const res = await app.request('/api/success', { method: 'GET' });

    expect(res.status).toBe(200);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'unknown',
        method: 'GET',
        path: '/api/success',
        status: 200,
      }),
    );
  });

  it('writes server log entries through transport', async () => {
    serverLogger.error('Transport check', { source: 'unit-test' });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.insertMock).toHaveBeenCalled();
    expect(mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        message: 'Transport check',
      }),
    );
  });

  it('server logger fails database down', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.insertValuesMock.mockRejectedValueOnce(new Error('DB down'));

    serverLogger.info('DB failure test', { source: 'unit-test' });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to log to DB:', expect.any(Error));

    consoleErrorSpy.mockRestore();
  });

  it('log request path length <= 1', async () => {
    const app = new Hono();
    app.use('*', userInteractionLogger);
    app.get('/', (c) => c.json({ ok: true }, 200));

    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'unknown',
        method: 'GET',
        path: '/',
      }),
    );

  });
});
