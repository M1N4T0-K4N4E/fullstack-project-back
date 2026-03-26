import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

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
});
