import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => {
  const serverCount = { value: 2 };
  const userCount = { value: 1 };
  const serverRows = { value: [{ id: 's1', level: 'info', message: 'ok' }] as any[] };
  const userRows = { value: [{ id: 'u1', path: '/api/posts', status: 200 }] as any[] };

  const fsExistsSyncMock = vi.fn();
  const fsReaddirSyncMock = vi.fn();
  const fsReadFileSyncMock = vi.fn();

  return {
    serverCount,
    userCount,
    serverRows,
    userRows,
    fsExistsSyncMock,
    fsReaddirSyncMock,
    fsReadFileSyncMock,
  };
});

vi.mock('../../../src/utils/logger.js', () => ({
  serverLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('node:fs', () => ({
  existsSync: mocks.fsExistsSyncMock,
  readdirSync: mocks.fsReaddirSyncMock,
  readFileSync: mocks.fsReadFileSyncMock,
}));

vi.mock('../../../src/db/index.js', () => ({
  db: {
    select: (...args: any[]) => {
      const firstArg = args[0] ?? {};
      if (firstArg.count) {
        return {
          from: (table: any) => {
            const tableName = String(table?.[Symbol.toStringTag] ?? table?.toString?.() ?? '');
            if (tableName.includes('server_logs')) {
              return Promise.resolve([{ count: mocks.serverCount.value }]);
            }
            return Promise.resolve([{ count: mocks.userCount.value }]);
          },
        };
      }

      return {
        from: (table: any) => {
          const tableName = String(table?.[Symbol.toStringTag] ?? table?.toString?.() ?? '');
          const rows = tableName.includes('server_logs') ? mocks.serverRows.value : mocks.userRows.value;
          return {
            orderBy: () => ({
              limit: () => ({
                offset: () => Promise.resolve(rows),
              }),
            }),
          };
        },
      };
    },
  },
}));

vi.mock('../../../src/middleware/auth.js', () => ({
  authAdminMiddleware: async (_c: any, next: () => Promise<void>) => {
    await next();
  },
}));

import logsRoute from '../../../src/routes/logs.js';

const createTestApp = () => {
  const app = new Hono();
  app.route('/api/logs', logsRoute);
  return app;
};

describe('Logs Routes Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.serverCount.value = 2;
    mocks.userCount.value = 1;
    mocks.serverRows.value = [{ id: 's1', level: 'info', message: 'ok' }];
    mocks.userRows.value = [{ id: 'u1', path: '/api/posts', status: 200 }];

    mocks.fsExistsSyncMock.mockReturnValue(false);
    mocks.fsReaddirSyncMock.mockReturnValue(['server.log', 'app.txt']);
    mocks.fsReadFileSyncMock.mockReturnValue('line1\nline2');
  });

  it('GET /api/logs/server returns paginated server logs', async () => {
    const app = createTestApp();

    const res = await app.request('/api/logs/server?page=1&limit=10');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.length).toBe(1);
  });

  it('GET /api/logs/user returns paginated user interactions', async () => {
    const app = createTestApp();

    const res = await app.request('/api/logs/user?page=1&limit=10');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.length).toBe(1);
  });

  it('GET /api/logs/files returns empty list when logs dir is missing', async () => {
    const app = createTestApp();
    mocks.fsExistsSyncMock.mockReturnValueOnce(false);

    const res = await app.request('/api/logs/files');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });

  it('GET /api/logs/files returns .log files only', async () => {
    const app = createTestApp();
    mocks.fsExistsSyncMock.mockReturnValueOnce(true);

    const res = await app.request('/api/logs/files');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(['server.log']);
  });

  it('GET /api/logs/files/:filename returns 404 for invalid extension', async () => {
    const app = createTestApp();
    mocks.fsExistsSyncMock.mockReturnValueOnce(true);

    const res = await app.request('/api/logs/files/not-log.txt');
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'Log file not found' });
  });

  it('GET /api/logs/files/:filename returns file content', async () => {
    const app = createTestApp();
    mocks.fsExistsSyncMock.mockReturnValueOnce(true);

    const res = await app.request('/api/logs/files/server.log');
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain('line1');
  });
});
