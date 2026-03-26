import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const infoMock = vi.fn();
  const errorMock = vi.fn();

  class RedisMock {
    public handlers: Record<string, (...args: any[]) => void> = {};

    on(event: string, handler: (...args: any[]) => void) {
      this.handlers[event] = handler;
      return this;
    }

    emit(event: string, ...args: any[]) {
      const handler = this.handlers[event];
      if (handler) handler(...args);
    }
  }

  return {
    infoMock,
    errorMock,
    RedisMock,
  };
});

vi.mock('../../../src/utils/logger.js', () => ({
  serverLogger: {
    info: mocks.infoMock,
    error: mocks.errorMock,
  },
}));

vi.mock('ioredis', () => ({
  Redis: mocks.RedisMock,
}));

describe('Redis Utils (real module)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers connect and error listeners on redis client', async () => {
    const { default: redis } = await import('../../../src/utils/redis.js');
    const redisInstance = redis as any;

    expect(redisInstance.handlers.connect).toBeTypeOf('function');
    expect(redisInstance.handlers.error).toBeTypeOf('function');
  });

  it('logs on redis connect event', async () => {
    const { default: redis } = await import('../../../src/utils/redis.js');
    const redisInstance = redis as any;

    redisInstance.emit('connect');

    expect(mocks.infoMock).toHaveBeenCalledWith('Redis client connected');
  });

  it('logs on redis error event', async () => {
    const { default: redis } = await import('../../../src/utils/redis.js');
    const redisInstance = redis as any;

    const err = new Error('redis-down');
    redisInstance.emit('error', err);

    expect(mocks.errorMock).toHaveBeenCalledWith('Redis client error', { error: err });
  });
});
