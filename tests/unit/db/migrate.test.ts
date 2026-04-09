import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const migrateMock = vi.fn();
  const exitMock = vi.fn();
  const logMock = vi.fn();
  const errorMock = vi.fn();

  return {
    migrateMock,
    exitMock,
    logMock,
    errorMock,
  };
});

vi.mock('drizzle-orm/node-postgres/migrator', () => ({
  migrate: mocks.migrateMock,
}));

vi.mock('../../../src/db/index.js', () => ({
  db: { id: 'mock-db' },
}));

describe('db migrate entrypoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    vi.stubGlobal('console', {
      log: mocks.logMock,
      error: mocks.errorMock,
    } as any);
    vi.stubGlobal('process', {
      ...process,
      exit: mocks.exitMock,
    } as any);
  });

  it('runs migrations with the drizzle migrations folder', async () => {
    mocks.migrateMock.mockResolvedValueOnce(undefined);

    await import('../../../src/db/migrate.js');

    expect(mocks.migrateMock).toHaveBeenCalledWith(
      { id: 'mock-db' },
      { migrationsFolder: './drizzle/migrations' },
    );
    expect(mocks.logMock).toHaveBeenCalledWith('Database migrations complete');
    expect(mocks.exitMock).not.toHaveBeenCalled();
  });

  it('exits with code 1 when migrations fail', async () => {
    mocks.migrateMock.mockRejectedValueOnce(new Error('migration failed'));

    await import('../../../src/db/migrate.js');

    expect(mocks.errorMock).toHaveBeenCalledWith('Database migration failed', expect.any(Error));
    expect(mocks.exitMock).toHaveBeenCalledWith(1);
  });
});