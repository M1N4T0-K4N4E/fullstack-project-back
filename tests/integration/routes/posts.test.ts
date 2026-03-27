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
  const selectWhereMock = vi.fn();
  const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
  const selectMock = vi.fn(() => ({ from: selectFromMock }));

  const postsFindManyMock = vi.fn();
  const postsFindFirstMock = vi.fn();
  const postLikesFindFirstMock = vi.fn();
  const postDislikesFindFirstMock = vi.fn();
  const usersFindFirstMock = vi.fn();

  const insertReturningMock = vi.fn();
  const insertValuesMock = vi.fn(() => ({ returning: insertReturningMock }));
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const updateReturningMock = vi.fn();
  const updateWhereMock = vi.fn(() => ({ returning: updateReturningMock }));
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const deleteReturningMock = vi.fn();
  const deleteWhereMock = vi.fn(() => ({ returning: deleteReturningMock }));
  const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

  const redisGetMock = vi.fn();
  const redisSetMock = vi.fn();
  const redisKeysMock = vi.fn();
  const redisDelMock = vi.fn();

  const fsExistsSyncMock = vi.fn();
  const fsMkdirMock = vi.fn();
  const fsWriteFileMock = vi.fn();

  const parseMock = vi.fn();

  const validateImageFileMock = vi.fn();
  const getImageExtensionMock = vi.fn();
  const validateImageMagicNumberMock = vi.fn();

  const txUpdateReturningMock = vi.fn();
  const txUpdateWhereMock = vi.fn(() => ({ returning: txUpdateReturningMock }));
  const txUpdateSetMock = vi.fn(() => ({ where: txUpdateWhereMock }));
  const txUpdateMock = vi.fn(() => ({ set: txUpdateSetMock }));
  const transactionMock = vi.fn(async (callback: (tx: any) => Promise<void>) => {
    await callback({ update: txUpdateMock });
  });

  const unifiedProcessMock = vi.fn();
  const unifiedUseMock = vi.fn();
  const unifiedBuilder = {
    use: unifiedUseMock,
    process: unifiedProcessMock,
  };
  unifiedUseMock.mockReturnValue(unifiedBuilder);

  return {
    selectWhereMock,
    selectFromMock,
    selectMock,
    postsFindManyMock,
    postsFindFirstMock,
    postLikesFindFirstMock,
    postDislikesFindFirstMock,
    usersFindFirstMock,
    insertReturningMock,
    insertValuesMock,
    insertMock,
    updateReturningMock,
    updateWhereMock,
    updateSetMock,
    updateMock,
    deleteReturningMock,
    deleteWhereMock,
    deleteMock,
    redisGetMock,
    redisSetMock,
    redisKeysMock,
    redisDelMock,
    fsExistsSyncMock,
    fsMkdirMock,
    fsWriteFileMock,
    parseMock,
    validateImageFileMock,
    getImageExtensionMock,
    validateImageMagicNumberMock,
    txUpdateReturningMock,
    txUpdateWhereMock,
    txUpdateSetMock,
    txUpdateMock,
    transactionMock,
    unifiedUseMock,
    unifiedProcessMock,
    unifiedBuilder,
  };
});

vi.mock('../../../src/utils/logger.js', () => ({
  serverLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../../src/utils/redis.js', () => ({
  default: {
    get: mocks.redisGetMock,
    set: mocks.redisSetMock,
    del: mocks.redisDelMock,
    keys: mocks.redisKeysMock,
  },
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: mocks.fsExistsSyncMock,
    promises: {
      mkdir: mocks.fsMkdirMock,
      writeFile: mocks.fsWriteFileMock,
    },
  },
}));

vi.mock('@shaderfrog/glsl-parser', () => ({
  parse: mocks.parseMock,
}));

vi.mock('unified', () => ({
  unified: () => mocks.unifiedBuilder,
}));

vi.mock('../../../src/utils/image.js', () => ({
  validateImageFile: mocks.validateImageFileMock,
  getImageExtension: mocks.getImageExtensionMock,
  validateImageMagicNumber: mocks.validateImageMagicNumberMock,
}));

vi.mock('../../../src/db/index.js', () => ({
  db: {
    select: mocks.selectMock,
    insert: mocks.insertMock,
    update: mocks.updateMock,
    delete: mocks.deleteMock,
    transaction: mocks.transactionMock,
    query: {
      posts: {
        findMany: mocks.postsFindManyMock,
        findFirst: mocks.postsFindFirstMock,
      },
      postLikes: {
        findFirst: mocks.postLikesFindFirstMock,
      },
      postDislikes: {
        findFirst: mocks.postDislikesFindFirstMock,
      },
      users: {
        findFirst: mocks.usersFindFirstMock,
      },
    },
  },
}));

vi.mock('../../../src/middleware/auth.js', () => ({
  authGuestMiddleware: async (_c: any, next: () => Promise<void>) => {
    await next();
  },
  authMiddleware: async (c: any, next: () => Promise<void>) => {
    const existingUser = c.get('user');
    if (!existingUser) {
      c.set('user', {
        id: 'user-1',
        email: 'user-1@example.com',
        role: USER_ROLES.USER,
        status: USER_STATUS.ACTIVE,
      });
    }
    await next();
  },
}));

import postsRoute from '../../../src/routes/posts.js';

const createTestApp = (userOverride?: Partial<{ id: string; email: string; role: string; status: string }>) => {
  const app = new Hono<TestEnv>();
  app.use('/api/posts/*', async (c, next) => {
    c.set('user', {
      id: 'user-1',
      email: 'user-1@example.com',
      role: USER_ROLES.USER,
      status: USER_STATUS.ACTIVE,
      ...userOverride,
    });
    await next();
  });
  app.route('/api/posts', postsRoute);
  return app;
};

const createGuestTestApp = () => {
  const app = new Hono<TestEnv>();
  app.route('/api/posts', postsRoute);
  return app;
};

describe('Posts Routes Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.selectWhereMock.mockResolvedValue([{ count: 2 }]);
    mocks.postsFindManyMock.mockResolvedValue([
      {
        id: 'post-1',
        title: 'Shader A',
        context: 'Context A',
        thumbnail: null,
        like: 0,
        dislike: 0,
        isPublic: true,
        isDeleted: false,
        createdAt: new Date(),
        user: { name: 'Alice' },
      },
    ]);

    mocks.postsFindFirstMock.mockResolvedValue(null);
    mocks.postLikesFindFirstMock.mockResolvedValue(null);
    mocks.postDislikesFindFirstMock.mockResolvedValue(null);
    mocks.usersFindFirstMock.mockResolvedValue({ status: USER_STATUS.ACTIVE });
    mocks.insertReturningMock.mockResolvedValue([{ id: 'created-post-id' }]);
    mocks.updateReturningMock.mockResolvedValue([]);
    mocks.deleteReturningMock.mockResolvedValue([]);

    mocks.redisGetMock.mockResolvedValue(null);
    mocks.redisSetMock.mockResolvedValue('OK');
    mocks.redisKeysMock.mockResolvedValue([]);
    mocks.redisDelMock.mockResolvedValue(1);

    mocks.fsExistsSyncMock.mockReturnValue(true);
    mocks.fsMkdirMock.mockResolvedValue(undefined);
    mocks.fsWriteFileMock.mockResolvedValue(undefined);

    mocks.parseMock.mockImplementation(() => undefined);

    mocks.validateImageFileMock.mockReturnValue({ valid: true });
    mocks.getImageExtensionMock.mockReturnValue('.png');
    mocks.validateImageMagicNumberMock.mockReturnValue(true);

    mocks.txUpdateReturningMock.mockResolvedValue([]);
    mocks.transactionMock.mockClear();

    mocks.unifiedProcessMock.mockResolvedValue('sanitized-context');
  });

  it('GET /api/posts returns paginated posts', async () => {
    const app = createTestApp();

    const res = await app.request('/api/posts?page=1&limit=10');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      data: expect.any(Array),
      total: 2,
      page: 1,
      limit: 10,
      totalPages: 1,
    });
    expect(mocks.postsFindManyMock).toHaveBeenCalledTimes(1);
  });

  it('GET /api/posts returns 500 on query failure', async () => {
    const app = createTestApp();

    mocks.selectWhereMock.mockRejectedValueOnce(new Error('db down'));

    const res = await app.request('/api/posts?page=1&limit=10');
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to fetch posts' });
  });

  it('GET /api/posts returns paginated posts for admin role', async () => {
    const app = createTestApp({ role: USER_ROLES.ADMIN });

    const res = await app.request('/api/posts?page=1&limit=10');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      data: expect.any(Array),
      total: 2,
      page: 1,
      limit: 10,
      totalPages: 1,
    });
  });

  it('GET /api/posts returns paginated posts for guest fallback user', async () => {
    const app = createGuestTestApp();

    const res = await app.request('/api/posts?page=1&limit=10');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      data: expect.any(Array),
      total: 2,
      page: 1,
      limit: 10,
      totalPages: 1,
    });
  });

  it('GET /api/posts/@me returns paginated own posts', async () => {
    const app = createTestApp();

    const res = await app.request('/api/posts/@me?page=1&limit=10');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      data: expect.any(Array),
      total: 2,
      page: 1,
      limit: 10,
      totalPages: 1,
    });
  });

  it('GET /api/posts/@me returns 500 on query failure', async () => {
    const app = createTestApp();

    mocks.selectWhereMock.mockRejectedValueOnce(new Error('db down'));

    const res = await app.request('/api/posts/@me?page=1&limit=10');
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to fetch posts' });
  });

  it('GET /api/posts/:id returns 404 when post is not found', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce(null);

    const res = await app.request('/api/posts/missing-post');
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'Post not found' });
  });

  it('GET /api/posts/:id returns post detail when post exists', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      title: 'Shader A',
      context: 'Context A',
      thumbnail: null,
      like: 5,
      dislike: 1,
      isPublic: true,
      isDeleted: false,
      createdAt: new Date(),
      user: { name: 'Alice' },
    });
    mocks.redisGetMock.mockResolvedValueOnce('vertex-shader').mockResolvedValueOnce('fragment-shader');
    mocks.postLikesFindFirstMock.mockResolvedValueOnce(null);

    const res = await app.request('/api/posts/post-1');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toBe('Post fetched successfully');
    expect(body.post).toMatchObject({
      id: 'post-1',
      vertex: 'vertex-shader',
      fragment: 'fragment-shader',
      isUserLiked: false,
    });
  });

  it('GET /api/posts/:id returns isUserLiked true when like exists', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      title: 'Shader A',
      context: 'Context A',
      thumbnail: null,
      like: 5,
      dislike: 1,
      isPublic: true,
      isDeleted: false,
      createdAt: new Date(),
      user: { name: 'Alice' },
    });
    mocks.redisGetMock.mockResolvedValueOnce('vertex-shader').mockResolvedValueOnce('fragment-shader');
    mocks.postLikesFindFirstMock.mockResolvedValueOnce({
      id: 'like-1',
      userId: 'user-1',
      postId: 'post-1',
    });

    const res = await app.request('/api/posts/post-1');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.post).toMatchObject({
      id: 'post-1',
      isUserLiked: true,
    });
  });

  it('GET /api/posts/:id works with guest fallback user context', async () => {
    const app = createGuestTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      title: 'Shader A',
      context: 'Context A',
      thumbnail: null,
      like: 5,
      dislike: 1,
      isPublic: true,
      isDeleted: false,
      createdAt: new Date(),
      user: { name: 'Alice' },
    });
    mocks.redisGetMock.mockResolvedValueOnce('vertex-shader').mockResolvedValueOnce('fragment-shader');
    mocks.postLikesFindFirstMock.mockResolvedValueOnce(null);

    const res = await app.request('/api/posts/post-1');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.post).toMatchObject({
      id: 'post-1',
      isUserLiked: false,
    });
  });

  it('GET /api/posts/:id returns 500 when fetching detail fails', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockRejectedValueOnce(new Error('db down'));

    const res = await app.request('/api/posts/post-1');
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to fetch post detail' });
  });

  it('POST /api/posts creates a post for active user', async () => {
    const app = createTestApp();

    mocks.usersFindFirstMock.mockResolvedValueOnce({ status: USER_STATUS.ACTIVE });

    const res = await app.request('/api/posts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'My first post' }),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({
      message: 'Post created successfully',
      postId: 'created-post-id',
    });
    expect(mocks.insertMock).toHaveBeenCalledTimes(1);
  });

  it('POST /api/posts returns 403 for timeout user', async () => {
    const app = createTestApp();

    mocks.usersFindFirstMock.mockResolvedValueOnce({ status: USER_STATUS.TIMEOUT });

    const res = await app.request('/api/posts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'Blocked post' }),
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden. You are timeout.' });
  });

  it('POST /api/posts returns 404 when user not found', async () => {
    const app = createTestApp();

    mocks.usersFindFirstMock.mockResolvedValueOnce(null);

    const res = await app.request('/api/posts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'new post' }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'User not found' });
  });

  it('POST /api/posts returns 500 when insert fails', async () => {
    const app = createTestApp();

    mocks.usersFindFirstMock.mockResolvedValueOnce({ status: USER_STATUS.ACTIVE });
    mocks.insertReturningMock.mockRejectedValueOnce(new Error('insert failed'));

    const res = await app.request('/api/posts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'new post' }),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to create post' });
  });

  it('PUT /api/posts/posts/:id/publish publishes post successfully for owner', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });

    const res = await app.request('/api/posts/posts/post-1/publish', {
      method: 'PUT',
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: 'Post published successfully' });
    expect(mocks.updateMock).toHaveBeenCalled();
  });

  it('PUT /api/posts/posts/:id/publish returns 403 for timeout user', async () => {
    const app = createTestApp({ status: USER_STATUS.TIMEOUT });

    const res = await app.request('/api/posts/posts/post-1/publish', {
      method: 'PUT',
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden. You are timeout.' });
  });

  it('PUT /api/posts/posts/:id/publish returns 404 when post is not found', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce(null);

    const res = await app.request('/api/posts/posts/missing-post/publish', {
      method: 'PUT',
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'Post not found' });
  });

  it('PUT /api/posts/posts/:id/publish returns 403 for non-owner', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'another-user',
    });

    const res = await app.request('/api/posts/posts/post-1/publish', {
      method: 'PUT',
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden. You do not have permission to publish this post.' });
  });

  it('PUT /api/posts/posts/:id/publish returns 500 when update fails', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });
    mocks.updateReturningMock.mockRejectedValueOnce(new Error('update failed'));

    const res = await app.request('/api/posts/posts/post-1/publish', {
      method: 'PUT',
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to publish post' });
  });

  it('PUT /api/posts/like/:id returns 404 when post is not found', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce(null);

    const res = await app.request('/api/posts/like/missing-post', {
      method: 'PUT',
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'Post not found' });
  });

  it('PUT /api/posts/like/:id likes a post when not liked yet', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-2',
      like: 2,
      dislike: 0,
    });
    mocks.postLikesFindFirstMock.mockResolvedValueOnce(null);

    const res = await app.request('/api/posts/like/post-1', {
      method: 'PUT',
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: 'Post liked successfully' });
    expect(mocks.insertMock).toHaveBeenCalled();
    expect(mocks.updateMock).toHaveBeenCalled();
  });

  it('PUT /api/posts/like/:id unlikes when already liked', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-2',
      like: 4,
      dislike: 0,
    });
    mocks.postLikesFindFirstMock.mockResolvedValueOnce({
      id: 'like-1',
      userId: 'user-1',
      postId: 'post-1',
    });

    const res = await app.request('/api/posts/like/post-1', {
      method: 'PUT',
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: 'Post liked successfully' });
    expect(mocks.deleteMock).toHaveBeenCalled();
    expect(mocks.updateMock).toHaveBeenCalled();
  });

  it('PUT /api/posts/like/:id returns 403 for timeout user', async () => {
    const app = createTestApp({ status: USER_STATUS.TIMEOUT });

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-2',
      like: 1,
      dislike: 0,
    });

    const res = await app.request('/api/posts/like/post-1', {
      method: 'PUT',
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden. You are timeout.' });
  });

  it('PUT /api/posts/like/:id returns 500 when query fails', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockRejectedValueOnce(new Error('db down'));

    const res = await app.request('/api/posts/like/post-1', {
      method: 'PUT',
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to like post' });
  });

  it('PUT /api/posts/dislike/:id returns 404 when post is not found', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce(null);

    const res = await app.request('/api/posts/dislike/missing-post', {
      method: 'PUT',
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'Post not found' });
  });

  it('PUT /api/posts/dislike/:id dislikes a post successfully', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-2',
      like: 0,
      dislike: 3,
    });
    mocks.postDislikesFindFirstMock.mockResolvedValueOnce(null);

    const res = await app.request('/api/posts/dislike/post-1', {
      method: 'PUT',
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: 'Post disliked successfully' });
    expect(mocks.insertMock).toHaveBeenCalled();
    expect(mocks.updateMock).toHaveBeenCalled();
  });

  it('PUT /api/posts/dislike/:id toggles dislike off when already disliked', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-2',
      like: 0,
      dislike: 3,
    });
    mocks.postDislikesFindFirstMock.mockResolvedValueOnce({
      id: 'dislike-1',
      userId: 'user-1',
      postId: 'post-1',
    });

    const res = await app.request('/api/posts/dislike/post-1', {
      method: 'PUT',
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: 'Post disliked successfully' });
    expect(mocks.deleteMock).toHaveBeenCalled();
  });

  it('PUT /api/posts/dislike/:id returns 500 when query fails', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockRejectedValueOnce(new Error('db down'));

    const res = await app.request('/api/posts/dislike/post-1', {
      method: 'PUT',
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to dislike post' });
  });

  it('PUT /api/posts/dislike/:id returns 403 for timeout user', async () => {
    const app = createTestApp({ status: USER_STATUS.TIMEOUT });

    const res = await app.request('/api/posts/dislike/post-1', {
      method: 'PUT',
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden. You are timeout.' });
  });

  it('DELETE /api/posts/:id returns 403 when user is not owner', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'another-user',
    });

    const res = await app.request('/api/posts/post-1', {
      method: 'DELETE',
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden. You do not have permission to delete this post.' });
  });

  it('DELETE /api/posts/:id marks post deleted for owner', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });
    mocks.redisKeysMock.mockResolvedValueOnce(['post-file:post-1:vertex', 'post-file:post-1:fragment']);

    const res = await app.request('/api/posts/post-1', {
      method: 'DELETE',
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: 'Post deleted' });
    expect(mocks.redisDelMock).toHaveBeenCalled();
    expect(mocks.updateMock).toHaveBeenCalled();
  });

  it('DELETE /api/posts/:id returns 404 when post does not exist', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce(null);

    const res = await app.request('/api/posts/post-1', {
      method: 'DELETE',
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'Post not found' });
  });

  it('DELETE /api/posts/:id allows admin to delete non-owned post', async () => {
    const app = createTestApp({ role: USER_ROLES.ADMIN });

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'another-user',
    });

    const res = await app.request('/api/posts/post-1', {
      method: 'DELETE',
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: 'Post deleted' });
  });

  it('DELETE /api/posts/:id returns 500 when redis keys lookup fails', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });
    mocks.redisKeysMock.mockRejectedValueOnce(new Error('redis down'));

    const res = await app.request('/api/posts/post-1', {
      method: 'DELETE',
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to delete post' });
  });

  it('PATCH /api/posts/:id/restore returns 403 when user is not owner', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'another-user',
    });

    const res = await app.request('/api/posts/post-1/restore', {
      method: 'PATCH',
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden. You do not have permission to restore this post.' });
  });

  it('PATCH /api/posts/:id/restore marks post restored for owner', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });

    const res = await app.request('/api/posts/post-1/restore', {
      method: 'PATCH',
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: 'Post restored' });
    expect(mocks.updateMock).toHaveBeenCalled();
  });

  it('PATCH /api/posts/:id/restore deletes redis files when keys exist', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });
    mocks.redisKeysMock.mockResolvedValueOnce(['post-file:post-1:vertex']);

    const res = await app.request('/api/posts/post-1/restore', {
      method: 'PATCH',
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: 'Post restored' });
    expect(mocks.redisDelMock).toHaveBeenCalledWith('post-file:post-1:vertex');
  });

  it('PATCH /api/posts/:id/restore returns 500 when redis keys lookup fails', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });
    mocks.redisKeysMock.mockRejectedValueOnce(new Error('redis down'));

    const res = await app.request('/api/posts/post-1/restore', {
      method: 'PATCH',
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to restore post' });
  });

  it('PATCH /api/posts/:id/restore returns 404 when post does not exist', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce(null);

    const res = await app.request('/api/posts/post-1/restore', {
      method: 'PATCH',
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'Post not found' });
  });

  it('PUT /api/posts/:id returns 404 when post does not exist', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce(null);

    const res = await app.request('/api/posts/post-404', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'Updated', context: 'content' }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'Post not found' });
  });

  it('PUT /api/posts/:id returns 403 for non-owner', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'another-user',
    });

    const res = await app.request('/api/posts/post-1', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'Updated', context: 'content' }),
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden. You do not have permission to update this post.' });
  });

  it('PUT /api/posts/:id returns 400 for invalid GLSL syntax', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });
    mocks.parseMock.mockImplementationOnce(() => {
      throw new Error('invalid glsl');
    });

    const res = await app.request('/api/posts/post-1', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Updated',
        context: '<p>ok</p>',
        vertex: 'bad shader',
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid GLSL syntax' });
  });

  it('PUT /api/posts/:id returns 400 for invalid fragment GLSL syntax', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });
    mocks.parseMock
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('invalid fragment glsl');
      });

    const res = await app.request('/api/posts/post-1', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Updated',
        context: '<p>ok</p>',
        vertex: 'void main(){}',
        fragment: 'bad shader',
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid GLSL syntax' });
  });

  it('PUT /api/posts/:id updates post successfully', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });

    const res = await app.request('/api/posts/post-1', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Updated title',
        context: '<p>safe</p>',
        vertex: 'void main(){}',
        fragment: 'void main(){}',
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: 'Post updated successfully' });
    expect(mocks.transactionMock).toHaveBeenCalled();
    expect(mocks.redisSetMock).toHaveBeenCalled();
  });

  it('PUT /api/posts/:id deletes previous redis files before saving new ones', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });
    mocks.redisGetMock
      .mockResolvedValueOnce('old-vertex')
      .mockResolvedValueOnce('old-fragment');

    const res = await app.request('/api/posts/post-1', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Updated title',
        context: '<p>safe</p>',
        vertex: 'void main(){}',
        fragment: 'void main(){}',
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: 'Post updated successfully' });
    expect(mocks.redisDelMock).toHaveBeenCalledWith('post-file:post-1:vertex');
    expect(mocks.redisDelMock).toHaveBeenCalledWith('post-file:post-1:fragment');
  });

  it('PUT /api/posts/:id returns 403 for timeout user', async () => {
    const app = createTestApp({ status: USER_STATUS.TIMEOUT });

    const res = await app.request('/api/posts/post-1', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Updated title',
        context: '<p>safe</p>',
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden. You are timeout.' });
  });

  it('PUT /api/posts/:id returns 500 when transaction fails', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });
    mocks.transactionMock.mockRejectedValueOnce(new Error('tx failed'));

    const res = await app.request('/api/posts/post-1', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Updated title',
        context: '<p>safe</p>',
        vertex: 'void main(){}',
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to update post' });
    expect(mocks.redisDelMock).toHaveBeenCalled();
  });

  it('PUT /api/posts/:id returns 500 when sanitizer process throws', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });
    mocks.unifiedProcessMock.mockRejectedValueOnce(new Error('sanitize failed'));

    const res = await app.request('/api/posts/post-1', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Updated title',
        context: '<p>safe</p>',
        vertex: 'void main(){}',
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to update post' });
  });

  it('PUT /api/posts/:id stores empty context when sanitizer returns nullish value', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });
    mocks.unifiedProcessMock.mockResolvedValueOnce(undefined);

    const res = await app.request('/api/posts/post-1', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Updated title',
        context: '<p>safe</p>',
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: 'Post updated successfully' });
    expect(mocks.txUpdateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ context: '' }),
    );
  });

  it('PUT /api/posts/:id/thumbnail returns 400 for invalid image file', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });
    mocks.usersFindFirstMock.mockResolvedValueOnce({ status: USER_STATUS.ACTIVE });
    mocks.validateImageFileMock.mockReturnValueOnce({ valid: false, error: 'Invalid file type. Only JPEG, PNG, and WEBP are allowed.' });

    const formData = new FormData();
    formData.append('file', new Blob(['fake-image'], { type: 'text/plain' }), 'test.txt');

    const res = await app.request('/api/posts/post-1/thumbnail', {
      method: 'PUT',
      body: formData,
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid file type. Only JPEG, PNG, and WEBP are allowed.' });
  });

  it('PUT /api/posts/:id/thumbnail returns default invalid image message when validator has no error', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });
    mocks.usersFindFirstMock.mockResolvedValueOnce({ status: USER_STATUS.ACTIVE });
    mocks.validateImageFileMock.mockReturnValueOnce({ valid: false });

    const formData = new FormData();
    formData.append('file', new Blob(['fake-image'], { type: 'text/plain' }), 'test.txt');

    const res = await app.request('/api/posts/post-1/thumbnail', {
      method: 'PUT',
      body: formData,
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid image file.' });
  });

  it('PUT /api/posts/:id/thumbnail updates thumbnail successfully', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });
    mocks.usersFindFirstMock.mockResolvedValueOnce({ status: USER_STATUS.ACTIVE });
    mocks.updateReturningMock.mockResolvedValueOnce([{ id: 'post-1' }]);

    const formData = new FormData();
    formData.append('file', new Blob(['\x89PNG'], { type: 'image/png' }), 'thumb.png');

    const res = await app.request('/api/posts/post-1/thumbnail', {
      method: 'PUT',
      body: formData,
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: 'Post thumbnail updated successfully', postId: 'post-1' });
    expect(mocks.fsWriteFileMock).toHaveBeenCalled();
    expect(mocks.updateMock).toHaveBeenCalled();
  });

  it('PUT /api/posts/:id/thumbnail returns 404 when post does not exist', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce(null);

    const formData = new FormData();
    formData.append('file', new Blob(['\x89PNG'], { type: 'image/png' }), 'thumb.png');

    const res = await app.request('/api/posts/post-1/thumbnail', {
      method: 'PUT',
      body: formData,
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'Post not found' });
  });

  it('PUT /api/posts/:id/thumbnail returns 403 for non-owner', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'another-user',
    });
    mocks.usersFindFirstMock.mockResolvedValueOnce({ status: USER_STATUS.ACTIVE });

    const formData = new FormData();
    formData.append('file', new Blob(['\x89PNG'], { type: 'image/png' }), 'thumb.png');

    const res = await app.request('/api/posts/post-1/thumbnail', {
      method: 'PUT',
      body: formData,
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden. You do not have permission to update this post.' });
  });

  it('PUT /api/posts/:id/thumbnail returns 404 when user status is not found', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });
    mocks.usersFindFirstMock.mockResolvedValueOnce(null);

    const formData = new FormData();
    formData.append('file', new Blob(['\x89PNG'], { type: 'image/png' }), 'thumb.png');

    const res = await app.request('/api/posts/post-1/thumbnail', {
      method: 'PUT',
      body: formData,
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'User not found' });
  });

  it('PUT /api/posts/:id/thumbnail returns 403 for timeout user status', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });
    mocks.usersFindFirstMock.mockResolvedValueOnce({ status: USER_STATUS.TIMEOUT });

    const formData = new FormData();
    formData.append('file', new Blob(['\x89PNG'], { type: 'image/png' }), 'thumb.png');

    const res = await app.request('/api/posts/post-1/thumbnail', {
      method: 'PUT',
      body: formData,
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden. You are timeout.' });
  });

  it('PUT /api/posts/:id/thumbnail returns 400 when file extension cannot be resolved', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });
    mocks.usersFindFirstMock.mockResolvedValueOnce({ status: USER_STATUS.ACTIVE });
    mocks.getImageExtensionMock.mockReturnValueOnce(null);

    const formData = new FormData();
    formData.append('file', new Blob(['\x89PNG'], { type: 'image/png' }), 'thumb.png');

    const res = await app.request('/api/posts/post-1/thumbnail', {
      method: 'PUT',
      body: formData,
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid file type. Only JPEG, PNG, and WEBP are allowed.' });
  });

  it('PUT /api/posts/:id/thumbnail returns 500 when write fails', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });
    mocks.usersFindFirstMock.mockResolvedValueOnce({ status: USER_STATUS.ACTIVE });
    mocks.fsWriteFileMock.mockRejectedValueOnce(new Error('write failed'));

    const formData = new FormData();
    formData.append('file', new Blob(['\x89PNG'], { type: 'image/png' }), 'thumb.png');

    const res = await app.request('/api/posts/post-1/thumbnail', {
      method: 'PUT',
      body: formData,
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to update post thumbnail' });
  });

  it('PUT /api/posts/:id/thumbnail returns 400 when magic number is invalid', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });
    mocks.usersFindFirstMock.mockResolvedValueOnce({ status: USER_STATUS.ACTIVE });
    mocks.validateImageMagicNumberMock.mockReturnValueOnce(false);

    const formData = new FormData();
    formData.append('file', new Blob(['fakepng'], { type: 'image/png' }), 'thumb.png');

    const res = await app.request('/api/posts/post-1/thumbnail', {
      method: 'PUT',
      body: formData,
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid file content.' });
  });

  it('PUT /api/posts/:id/thumbnail creates folder when not exists', async () => {
    const app = createTestApp();

    mocks.postsFindFirstMock.mockResolvedValueOnce({
      id: 'post-1',
      userId: 'user-1',
    });
    mocks.usersFindFirstMock.mockResolvedValueOnce({ status: USER_STATUS.ACTIVE });
    mocks.updateReturningMock.mockResolvedValueOnce([{ id: 'post-1' }]);
    mocks.fsExistsSyncMock.mockReturnValueOnce(false);

    const formData = new FormData();
    formData.append('file', new Blob(['\x89PNG'], { type: 'image/png' }), 'thumb.png');

    const res = await app.request('/api/posts/post-1/thumbnail', {
      method: 'PUT',
      body: formData,
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: 'Post thumbnail updated successfully', postId: 'post-1' });
    expect(mocks.fsMkdirMock).toHaveBeenCalled();
  });
});
