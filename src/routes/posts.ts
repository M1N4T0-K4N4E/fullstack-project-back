import { Hono } from 'hono'
import { serverLogger } from '../utils/logger.js'
import { db } from '../db/index.js'
import { posts } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware } from '../middleware/auth.js'
import type { Variables } from '../middleware/auth.js'
import { USER_ROLES, FILE_UPLOAD_TYPE } from '../constants.js'
import { v4 as uuidv4 } from 'uuid'
import redis from '../utils/redis.js'

const postsAPI = new Hono<{ Variables: Variables }>()

const fileSchema = z.object({
  fileType: z.enum(FILE_UPLOAD_TYPE),
  content: z.string()
})

const createPostSchema = z.object({
  title: z.string().min(1),
  context: z.string(),
  picture: z.string(),
  files: z.array(fileSchema),
})

// GET /api/posts - List all current posts
postsAPI.get('/', async (c) => {
  try {
    const allPosts = await db.query.posts.findMany({
      with: {
        user: {
          columns: {
            name: true,
          }
        }
      },
      columns: {
        userId: false,
        createdAt: false,
        updatedAt: false,
      }
    })
    return c.json(allPosts)
  } catch (e) {
    serverLogger.error('Failed to fetch posts', { error: e })
    return c.json({ error: 'Failed to fetch posts' }, 500)
  }
})

// GET /api/posts/:id - Get post detail
postsAPI.get('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, id),
      with: {
        user: {
          columns: {
            name: true,
          }
        }
      },
      columns: {
        userId: false,
        createdAt: false,
        updatedAt: false,
      }
    })
    if (!post) {
      return c.json({ error: 'Post not found' }, 404)
    }

    // Fetch files from Redis
    const fileKeys = await redis.keys(`post-file:${id}:*`)
    const fileContents = fileKeys.length > 0 ? await redis.mget(...fileKeys) : []
    const files = fileContents
      .map(content => content ? JSON.parse(content) : null)
      .filter(Boolean)

    serverLogger.info('Post fetched successfully', { postId: id, fileCount: files.length })
    return c.json({message: 'Post fetched successfully', post: {...post, files }}, 200)
  } catch (e) {
    serverLogger.error('Failed to fetch post detail', { error: e })
    return c.json({ error: 'Failed to fetch post detail' }, 500)
  }
})

// POST /api/posts - Create an post
postsAPI.post(
  '/',
  authMiddleware,
  zValidator('json', createPostSchema, (result, c) => {
    if (!result.success) return c.json({ error: 'Invalid input', details: result.error.issues }, 400)
  }),
  async (c) => {
    const user = c.get('user')
    if (user.timeoutStatus == true) {
      return c.json({ error: 'Forbidden. You are timeout.' }, 403)
    }

    const { title, context, picture, files: fileData } = c.req.valid('json')
    const uploadedRedisFiles : string[] = []

    try {
      const result = await db.transaction(async (tx) => {
        const [newPost] = await tx.insert(posts).values({
          title,
          context,
          picture,
          userId: user.id,
        }).returning({ id: posts.id})

        for (const file of fileData) {
          const fileId = uuidv4()
          const redisFile = {
            id: fileId,
            postId: newPost.id,
            fileType: file.fileType,
            content: file.content
          }
          const fullKey = `post-file:${newPost.id}:${fileId}`
          await redis.set(fullKey, JSON.stringify(redisFile))
          uploadedRedisFiles.push(fullKey)
        }
      })

      serverLogger.info('Post created successfully', { post: {title, context, picture}, fileCount: uploadedRedisFiles.length })
      return c.json({ message: 'Post created successfully'}, 201)
    } catch (e) {
      serverLogger.error('Failed to create post rollback', { error: e })
      // Rollback uploaded files
      await Promise.all(uploadedRedisFiles.map(fullKey => redis.del(fullKey)))
      return c.json({ error: 'Failed to create post' }, 500)
    }
  }
)

// PUT /api/posts/:id - Update an post
const updatePostSchema = z.object({
  title: z.string().optional(),
  context: z.string().optional(),
  picture: z.string().optional(),
  files: z.array(fileSchema).optional(),
})

postsAPI.put(
  '/:id',
  authMiddleware,
  zValidator('json', updatePostSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: 'Invalid input' }, 400)
    }
    
  }),
  async (c) => {
    const id = c.req.param('id')
    const user = c.get('user')

    if (user.timeoutStatus == true) {
      return c.json({ error: 'Forbidden. You are timeout.' }, 403)
    }

    try {
      const post = await db.query.posts.findFirst({
        where: eq(posts.id, id)
      })
      if (!post) {
        return c.json({ error: 'Post not found' }, 404)
      }
      if (post.userId !== user.id) {
        return c.json({ error: 'Forbidden. You do not have permission to update this post.' }, 403)
      }

      const { title, context, picture, files: fileData } = c.req.valid('json')
      const uploadedRedisFiles: string[] = []

      try {
        await db.transaction(async (tx) => {
          await tx.update(posts)
            .set({
              title: title ?? post.title,
              context: context ?? post.context,
              picture: picture ?? post.picture,
              updatedAt: new Date()
            })
            .where(eq(posts.id, id))

          // Update files
          if (fileData && fileData.length > 0) {
            for (const file of fileData) {
              const fileId = uuidv4()
              const redisFile = {
                id: fileId,
                postId: id,
                fileType: file.fileType,
                content: file.content
              }
              const fullKey = `post-file:${id}:${file.fileType}`
              await redis.del(fullKey)
              await redis.set(fullKey, JSON.stringify(redisFile))
              uploadedRedisFiles.push(fullKey)
            }
          }
        })

        serverLogger.info('Post updated successfully', { postId: id, fileCount: uploadedRedisFiles.length })
        return c.json({ message: 'Post updated successfully' }, 200)
      } catch (e) {
        serverLogger.error('Failed to update post', { error: e })
        // Rollback newly uploaded files
        await Promise.all(uploadedRedisFiles.map(fullKey => redis.del(fullKey)))
        return c.json({ error: 'Failed to update post' }, 500)
      }
    } catch (e) {
      serverLogger.error('Failed to fetch post for update', { error: e })
      return c.json({ error: 'Failed to update post' }, 500)
    }
  }
)

// PUT /api/post/like/:id - Like an post
postsAPI.put('/like/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')

  try {
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, id)
    })
    if (!post) {
      serverLogger.error('Post not found', { postId: id })
      return c.json({ error: 'Post not found' }, 404)
    }

    if (user.timeoutStatus == true) {
      serverLogger.error('Forbidden. User is timeout.', { userId: user.id })
      return c.json({ error: 'Forbidden. You are timeout.' }, 403)
    }

    const [updatedPost] = await db.update(posts)
      .set({
        like: post.like + 1
      })
      .where(eq(posts.id, id))
      .returning()
    
    serverLogger.info('Post liked successfully', { postId: id })
    return c.json({ message: 'Post liked successfully' }, 200)
  } catch (e) {
    serverLogger.error('Failed to fetch post for like', { error: e })
    return c.json({ error: 'Failed to like post' }, 500)
  }
})

// DELETE /api/posts/:id - Delete an post
postsAPI.delete('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')

  try {
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, id)
    })
    if (!post) return c.json({ error: 'Post not found' }, 404)

    if (user.role !== USER_ROLES.ADMIN && post.userId !== user.id) {
      return c.json({ error: 'Forbidden. You do not have permission to delete this post.' }, 403)
    }

    // Delete files from Redis - Use keys pattern to find all related files
    const fileKeys = await redis.keys(`post-file:${id}:*`)
    if (fileKeys.length > 0) {
      await redis.del(...fileKeys)
    }

    await db.delete(posts).where(eq(posts.id, id))
    serverLogger.info('Post deleted successfully', { postId: id })
    return c.json({ message: 'Post deleted' }, 200)
  } catch (e) {
    serverLogger.error('Failed to delete post', { error: e })
    return c.json({ error: 'Failed to delete post' }, 500)
  }
})

export default postsAPI
