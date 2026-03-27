import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => {
  const serveMock = vi.fn();
  const loggerInfoMock = vi.fn();
  const loggerWarnMock = vi.fn();

  return {
    serveMock,
    loggerInfoMock,
    loggerWarnMock,
  };
});

const passthroughMiddleware: MiddlewareHandler = async (_c, next) => {
  await next();
};

vi.mock('@hono/node-server', () => ({
  serve: mocks.serveMock,
}));

vi.mock('@hono/node-server/serve-static', () => ({
  serveStatic: () => passthroughMiddleware,
}));

vi.mock('hono/cors', () => ({
  cors: () => passthroughMiddleware,
}));

vi.mock('hono-openapi', () => ({
  openAPIRouteHandler: () => (c: any) => c.json({ ok: true }),
}));

vi.mock('@scalar/hono-api-reference', () => ({
  Scalar: () => (c: any) => c.html('scalar'),
}));

vi.mock('hono/basic-auth', () => ({
  basicAuth: () => passthroughMiddleware,
}));

vi.mock('../../src/utils/logger.js', () => ({
  serverLogger: {
    info: mocks.loggerInfoMock,
    warn: mocks.loggerWarnMock,
    error: vi.fn(),
  },
  userInteractionLogger: passthroughMiddleware,
}));

vi.mock('../../src/routes/account.js', () => {
  const route = new Hono();
  route.get('/', (c) => c.json({ route: 'account' }));
  return { default: route };
});

vi.mock('../../src/routes/auth.js', () => {
  const route = new Hono();
  route.get('/', (c) => c.json({ route: 'auth' }));
  return { default: route };
});

vi.mock('../../src/routes/posts.js', () => {
  const route = new Hono();
  route.get('/', (c) => c.json({ route: 'posts' }));
  return { default: route };
});

vi.mock('../../src/routes/roles.js', () => {
  const route = new Hono();
  route.get('/', (c) => c.json({ route: 'roles' }));
  return { default: route };
});

vi.mock('../../src/routes/users.js', () => {
  const route = new Hono();
  route.get('/', (c) => c.json({ route: 'users' }));
  return { default: route };
});

vi.mock('../../src/routes/logs.js', () => {
  const route = new Hono();
  route.get('/', (c) => c.json({ route: 'logs' }));
  return { default: route };
});

describe('App Bootstrap (index.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.SCALAR_USERNAME = 'scalar-user';
    process.env.SCALAR_PASSWORD = 'scalar-pass';

    mocks.serveMock.mockImplementation((options: any, callback?: (info: { port: number }) => void) => {
      callback?.({ port: 3001 });
      return options;
    });
  });

  it('starts server and exposes root endpoint via captured fetch handler', async () => {
    await import('../../src/index.js');

    expect(mocks.serveMock).toHaveBeenCalledTimes(1);
    expect(mocks.loggerInfoMock).toHaveBeenCalledWith('Server is running on http://localhost:3001');

    const [serveOptions] = mocks.serveMock.mock.calls[0];
    expect(serveOptions).toMatchObject({ port: 3001 });

    const res = await serveOptions.fetch(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe('Shaderd API');
  });

  it('mounts API routes into app fetch', async () => {
    await import('../../src/index.js');

    const [serveOptions] = mocks.serveMock.mock.calls[0];
    const res = await serveOptions.fetch(new Request('http://localhost/api/auth'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ route: 'auth' });
  });

  it('warns when scalar credentials are not set', async () => {
    delete process.env.SCALAR_USERNAME;
    delete process.env.SCALAR_PASSWORD;

    await import('../../src/index.js');

    expect(mocks.loggerWarnMock).toHaveBeenCalledWith(
      'Scalar API credentials are not set. Scalar documentation will be protected by basic auth with default credentials.',
    );
  });
});
