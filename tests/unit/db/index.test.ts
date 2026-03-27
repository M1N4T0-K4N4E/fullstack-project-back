import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const poolCtorMock = vi.fn();
  const drizzleMock = vi.fn();

  return {
    poolCtorMock,
    drizzleMock,
  };
});

vi.mock('pg', () => ({
  default: {
    Pool: mocks.poolCtorMock,
  },
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: mocks.drizzleMock,
}));

describe('DB Index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/testdb';

    mocks.poolCtorMock.mockReturnValue({ id: 'mock-pool' });
    mocks.drizzleMock.mockReturnValue({ id: 'mock-db' });
  });

  it('creates pg pool with DATABASE_URL and passes schema to drizzle', async () => {
    const schema = await import('../../../src/db/schema.js');
    const module = await import('../../../src/db/index.js');

    expect(mocks.poolCtorMock).toHaveBeenCalledWith({
      connectionString: 'postgres://test:test@localhost:5432/testdb',
    });

    expect(mocks.drizzleMock).toHaveBeenCalledWith(
      { id: 'mock-pool' },
      { schema },
    );

    expect(module.db).toEqual({ id: 'mock-db' });
  });
});
