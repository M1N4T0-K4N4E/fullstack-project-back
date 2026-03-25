import { Hono } from 'hono'
import { serverLogger } from '../utils/logger.js'
import { db } from '../db/index.js'
import { posts, users } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware } from '../middleware/auth.js'
import type { Variables } from '../middleware/auth.js'
import { USER_ROLES, USER_STATUS, type ShaderFile } from '../constants.js'
import redis from '../utils/redis.js'
import { parse, GlslSyntaxError } from '@shaderfrog/glsl-parser'
import path from 'path'
import * as fs from 'fs'
import { unified } from 'unified'
import rehypeParse from 'rehype-parse'
import rehypeSanitize from 'rehype-sanitize'
import rehypeRemark from 'rehype-remark'
import remarkStringify from 'rehype-stringify' 


const postsAPI = new Hono<{ Variables: Variables }>()

const createPostSchema = z.object({
  title: z.string(),
})

const updatePostSchema = z.object({
  title: z.string().optional(),
  context: z.string().optional(),
  vertex: z.string().optional(),
  Fragment: z.string().optional(),
})

const updatePostThumbnailSchema = z.object({
  file: z.instanceof(Blob),
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

// GET /api/posts/:id - Get specific post detail
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
        updatedAt: false,
      }
    })
    if (!post) {
      serverLogger.error('Post not found', { postId: id })
      return c.json({ error: 'Post not found' }, 404)
    }

    // Fetch files from Redis
    const vertexKey = `post-file:${id}:vertex`
    const fragmentKey = `post-file:${id}:fragment`
    const [vertexFile, fragmentFile] = await Promise.all([
      redis.get(vertexKey),
      redis.get(fragmentKey),
    ])
    

    serverLogger.info('Post fetched successfully', { postId: id })
    return c.json({message: 'Post fetched successfully', post: {...post, vertex: vertexFile, fragment: fragmentFile }}, 200)
  } catch (e) {
    serverLogger.error('Failed to fetch post detail', { error: e })
    return c.json({ error: 'Failed to fetch post detail' }, 500)
  }
})

// POST /api/posts - Create a post
postsAPI.post(
  '/',
  authMiddleware,
  zValidator('json', createPostSchema, (result, c) => {
    if (!result.success) return c.json({ error: 'Invalid input' }, 400)
  }),
  async (c) => {
    const user = c.get('user');
    const { title } = c.req.valid('json');

    const userStatus = await db.query.users.findFirst({
      where: eq(users.id, user.id),
      columns: {
        status: true,
      }
    })

    if (!userStatus) {
      serverLogger.error('User not found', { userId: user.id })
      return c.json({ error: 'User not found' }, 404)
    }

    if (userStatus?.status == USER_STATUS.TIMEOUT) {
      serverLogger.error('Forbidden. User is timeout.', { userId: user.id })
      return c.json({ error: 'Forbidden. You are timeout.' }, 403)
    }

    try {
      const [newPost] = await db.insert(posts)
        .values({
          title,
          userId: user.id,
        })
        .returning({
          id: posts.id,
          });
      
      serverLogger.info('Post created successfully', { postId: newPost.id });
      return c.json({ message: 'Post created successfully', postId: newPost.id }, 201);
    } catch (e) {
      serverLogger.error('Failed to create post', { error: e });
      return c.json({ error: 'Failed to create post' }, 500);
    }
  }
)

// PUT /api/post/:id/thumbnail - Update a post thumbnail
postsAPI.put(
  '/:id/thumbnail', zValidator('form', updatePostThumbnailSchema, (result, c) => {
    if (!result.success) return c.json({ error: 'Invalid input' }, 400)
  }),
  async (c) => {
    const id = c.req.param('id')
    const user = c.get('user')
    const { file } = c.req.valid('form')
    try {
      const post = await db.query.posts.findFirst({
        where: eq(posts.id, id)
      })

      if (!post) {
        return c.json({ error: 'Post not found' }, 404)
      }

      const userStatus = await db.query.users.findFirst({
        where: eq(users.id, user.id),
        columns: {
          status: true,
        }
      })

      if (!userStatus) {
        serverLogger.error('User not found', { userId: user.id })
        return c.json({ error: 'User not found' }, 404)
      }

      if (userStatus?.status == USER_STATUS.TIMEOUT) {
        serverLogger.error('Forbidden. User is timeout.', { userId: user.id })
        return c.json({ error: 'Forbidden. You are timeout.' }, 403)
      }

      if (post.userId !== user.id) {
        return c.json({ error: 'Forbidden. You do not have permission to update this post.' }, 403)
      }

      const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB limit
      const MIME_MAP: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
      };
    
      const fileExt = MIME_MAP[file.type]
      if (!fileExt) {
        serverLogger.error('Invalid file type', { fileType: file.type })
        return c.json({ error: 'Invalid file type. Only JPEG, PNG, and WEBP are allowed.' }, 400)
      }

      if (file.size > MAX_FILE_SIZE) {
        serverLogger.error('File size exceeds the 5MB limit', { fileSize: file.size })
        return c.json({ error: 'File size exceeds the 5MB limit.' }, 400)
      }
    
      const filename = 'thumbnail' + fileExt
      const targetDir = path.join(process.cwd(), 'uploads', 'posts', id)
      
      if (!fs.existsSync(targetDir)) {
        await fs.promises.mkdir(targetDir, { recursive: true })
      }

      const savePath = path.join(targetDir, filename)
      const arrayBuffer = await (file as Blob).arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      // Magic number check to guarantee the file is a valid image
      const header = buffer.subarray(0, 12)
      let isValidMagicNumber = false

      if (file.type === 'image/jpeg') {
        // JPEG starts with FF D8 FF
        isValidMagicNumber = header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF
      } else if (file.type === 'image/png') {
        // PNG starts with 89 50 4E 47 0D 0A 1A 0A
        isValidMagicNumber = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47
      } else if (file.type === 'image/webp') {
        // WebP starts with RIFF (offset 0) and WEBP (offset 8)
        const isRiff = header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 // "RIFF"
        const isWebp = header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50 // "WEBP"
        isValidMagicNumber = isRiff && isWebp
      }

      if (!isValidMagicNumber) {
        serverLogger.error('Magic number check failed', { fileType: file.type, header: header.toString('hex') })
        return c.json({ error: 'Invalid file content.' }, 400)
      }

      await fs.promises.writeFile(savePath, buffer)

      const picture = `/uploads/posts/${id}/${filename}`
      const [updatedPost] = await db.update(posts)
        .set({
          thumbnail: picture,
          updatedAt: new Date()
        })
        .where(eq(posts.id, id))
        .returning({
          id: posts.id,
        })
      serverLogger.info('Post thumbnail updated successfully', { postId: updatedPost.id })
      return c.json({ message: 'Post thumbnail updated successfully', postId: updatedPost.id }, 200)
    } catch (e) {
      serverLogger.error('Failed to update post thumbnail', { error: e })
      return c.json({ error: 'Failed to update post thumbnail' }, 500)
    }
  }
  )

// PUT /api/posts/:id - Update a post
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

    if (user.status == USER_STATUS.TIMEOUT) {
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

      const { title, context, vertex, Fragment } = c.req.valid('json')
      const uploadedRedisFiles: string[] = []

      const sanitizedTitle = unified()
        .use(rehypeParse, {fragment: true})
        .use(rehypeSanitize)
        .use(rehypeRemark)
        .use(remarkStringify)
        .processSync(title)
      console.log(sanitizedTitle.result)

      const sanitizedContext = unified()
        .use(rehypeParse, {fragment: true})
        .use(rehypeSanitize)
        .use(rehypeRemark)
        .use(remarkStringify)
        .processSync(context)
      console.log(sanitizedContext.result)

      try {
        await db.transaction(async (tx) => {
          await tx.update(posts)
            .set({
              title: title ?? post.title,
              context: context ?? post.context,
              updatedAt: new Date()
            })
            .where(eq(posts.id, id))

          let error: GlslSyntaxError | undefined;

          // Update files
          const vertexKey = `post-file:${id}:vertex`
          const fragmentKey = `post-file:${id}:fragment`

          if (vertex) {
            try {
              parse(vertex)
            } catch (e) {
              error = e as GlslSyntaxError
            }

            if (error) {
              serverLogger.error('Invalid GLSL syntax', { error })
              return c.json({ error: 'Invalid GLSL syntax' }, 400)
            }

            const redisFile: ShaderFile = {
              content: vertex
            }

            const oldVertex = await redis.get(vertexKey)
            if (oldVertex) {
              await redis.del(vertexKey)
            }
            await redis.set(vertexKey, JSON.stringify(redisFile))
            uploadedRedisFiles.push(vertexKey)
          }

          if (Fragment) {
            try {
              parse(Fragment)
            } catch (e) {
              error = e as GlslSyntaxError
            }

            if (error) {
              serverLogger.error('Invalid GLSL syntax', { error })
              return c.json({ error: 'Invalid GLSL syntax' }, 400)
            }

            const redisFile: ShaderFile = {
              content: Fragment
            }

            const oldFragment = await redis.get(fragmentKey)
            if (oldFragment) {
              await redis.del(fragmentKey)
            }
          await redis.set(fragmentKey, JSON.stringify(redisFile))
          uploadedRedisFiles.push(fragmentKey)
        }
        })

        serverLogger.info('Post updated successfully', { postId: id, fileCount: uploadedRedisFiles.length })
        return c.json({ message: 'Post updated successfully' }, 200)
      } catch (e) {
        serverLogger.error('Failed to update post', { error: e })
        await redis.del(uploadedRedisFiles)
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

    if (user.status == USER_STATUS.TIMEOUT) {
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
