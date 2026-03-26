import { Hono } from 'hono'
import { serverLogger } from '../utils/logger.js'
import { db } from '../db/index.js'
import { postDislikes, postLikes, posts, users } from '../db/schema.js'
import { and, desc, eq, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware, authGuestMiddleware } from '../middleware/auth.js'
import type { Variables } from '../middleware/auth.js'
import { PAGINATION, USER_ROLES, USER_STATUS } from '../constants.js'
import redis from '../utils/redis.js'
import { parse, GlslSyntaxError } from '@shaderfrog/glsl-parser'
import path from 'path'
import * as fs from 'fs'
import { unified } from 'unified'
import rehypeParse from 'rehype-parse'
import rehypeSanitize from 'rehype-sanitize'
import rehypeRemark from 'rehype-remark'
import remarkStringify from 'remark-stringify'
import { describeRoute } from 'hono-openapi'
import type { OpenAPIV3_1 } from 'openapi-types'
import { getImageExtension, validateImageFile, validateImageMagicNumber } from '../utils/image.js'


const postsAPI = new Hono<{ Variables: Variables }>()

const createPostSchema = z.object({
  title: z.string(),
})

const updatePostSchema = z.object({
  title: z.string().optional(),
  context: z.string().optional(),
  vertex: z.string().optional(),
  fragment: z.string().optional(),
})

const updatePostThumbnailSchema = z.object({
  file: z.instanceof(Blob),
})

const PaginationParams = z.object({
  page: z.string().default(String(PAGINATION.DEFAULT_PAGE)).transform(Number).pipe(z.number().int().min(PAGINATION.DEFAULT_PAGE)),
  limit: z.string().default(String(PAGINATION.DEFAULT_LIMIT)).transform(Number).pipe(z.number().int().min(PAGINATION.MIN_LIMIT).max(PAGINATION.MAX_LIMIT)),
})

// OpenAPI Response Schemas
const ErrorResponseSchema: OpenAPIV3_1.ResponseObject = {
  description: 'Error response',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          error: { type: 'string' },
        },
      },
    },
  },
};

const PostSchema: OpenAPIV3_1.SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    context: { type: 'string' },
    thumbnail: { type: ['string', 'null'] },
    like: { type: 'integer' },
    dislike: { type: 'integer' },
    isDeleted: { type: 'boolean' },
    isPublic: { type: 'boolean' },
    createdAt: { type: 'string' },
    user: {
      type: 'object',
      properties: {
        name: { type: ['string', 'null'] },
      },
    },
  },
};

const PostListResponseSchema: OpenAPIV3_1.ResponseObject = {
  description: 'Paginated list of posts',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: PostSchema,
          },
          total: { type: 'integer' },
          page: { type: 'integer' },
          limit: { type: 'integer' },
          totalPages: { type: 'integer' },
        },
      },
    },
  },
};

const PostDetailResponseSchema: OpenAPIV3_1.ResponseObject = {
  description: 'Post detail',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          post: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              context: { type: 'string' },
              thumbnail: { type: ['string', 'null'] },
              like: { type: 'integer' },
              dislike: { type: 'integer' },
              isUserLiked: { type: 'boolean' },
              vertex: { type: ['string', 'null'] },
              fragment: { type: ['string', 'null'] },
              isPublic: { type: 'boolean' },
              createdAt: { type: 'string' },
              user: {
                type: 'object',
                properties: {
                  name: { type: ['string', 'null'] },
                },
              },
            },
          },
        },
      },
    },
  },
};

const CreatePostRequestSchema: OpenAPIV3_1.RequestBodyObject = {
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string' },
        },
      },
    },
  },
};

const CreatePostResponseSchema: OpenAPIV3_1.ResponseObject = {
  description: 'Post created successfully',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          postId: { type: 'string' },
        },
      },
    },
  },
};

const UpdatePostRequestSchema: OpenAPIV3_1.RequestBodyObject = {
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          context: { type: 'string' },
          vertex: { type: 'string' },
          fragment: { type: 'string' },
        },
      },
    },
  },
};

const MessageResponseSchema: OpenAPIV3_1.ResponseObject = {
  description: 'Success message',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
        },
      },
    },
  },
};

// GET /api/posts - List all current posts
postsAPI.get(
  '/',
  describeRoute({
    operationId: 'listPosts',
    tags: ['posts'],
    summary: 'List all posts',
    description: 'Get a paginated list of all posts with user info',
    parameters: [
      {
        name: 'page',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: PAGINATION.DEFAULT_PAGE, minimum: PAGINATION.DEFAULT_PAGE },
      },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: PAGINATION.DEFAULT_LIMIT, minimum: PAGINATION.MIN_LIMIT, maximum: PAGINATION.MAX_LIMIT },
      },
    ],
    responses: {
      200: PostListResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  authGuestMiddleware,
  zValidator('query', PaginationParams),
  async (c) => {
    let allPosts;
    const user = c.get('user') ?? { id: 'guest', email: 'guest', role: USER_ROLES.USER  }
    const { page, limit } = c.req.valid('query')
    const offset = (page - 1) * limit
    try {
      const whereClause = user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.MODERATOR
      ? and(eq(posts.isPublic, true), eq(posts.isDeleted, false))
      : eq(posts.isDeleted, false)

      const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(posts).where(whereClause)

      if (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.MODERATOR) {
        allPosts = await db.query.posts.findMany({
          orderBy: desc(posts.createdAt),
          limit,
          offset,
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
      } else {
        allPosts = await db.query.posts.findMany({
          where: and(eq(posts.isPublic, true), eq(posts.isDeleted, false)),
          orderBy: desc(posts.createdAt),
          limit,
          offset,
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
      }
      const totalPages = Math.ceil(count / limit)
      return c.json({ data: allPosts, total: count, page, limit, totalPages })
    } catch (e) {
      serverLogger.error('Failed to fetch posts', { error: e })
      return c.json({ error: 'Failed to fetch posts' }, 500)
    }
  }
)

// GET /api/posts/@me - List all own posts
postsAPI.get(
  '/@me',
  describeRoute({
    operationId: 'listPosts',
    tags: ['posts'],
    summary: 'List all posts',
    description: 'Get a paginated list of own posts with user info',
    parameters: [
      {
        name: 'page',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: PAGINATION.DEFAULT_PAGE, minimum: PAGINATION.DEFAULT_PAGE },
      },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: PAGINATION.DEFAULT_LIMIT, minimum: PAGINATION.MIN_LIMIT, maximum: PAGINATION.MAX_LIMIT },
      },
    ],
    responses: {
      200: PostListResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  authMiddleware,
  zValidator('query', PaginationParams),
  async (c) => {
    const user = c.get('user')
    const { page, limit } = c.req.valid('query')
    const offset = (page - 1) * limit
    try {
      const [{ count }] = await db.select({ count: sql<number>`count(*)` })
        .from(posts)
        .where(and(eq(posts.userId, user.id), eq(posts.isDeleted, false)))

      const allPosts = await db.query.posts.findMany({
        where: and(eq(posts.userId, user.id), eq(posts.isDeleted, false)),
        orderBy: desc(posts.createdAt),
        limit,
        offset,
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
      const totalPages = Math.ceil(count / limit)
      return c.json({ data: allPosts, total: count, page, limit, totalPages })
    } catch (e) {
      serverLogger.error('Failed to fetch posts', { error: e })
      return c.json({ error: 'Failed to fetch posts' }, 500)
    }
  }
)

// GET /api/posts/:id - Get specific post detail
postsAPI.get(
  '/:id',
  describeRoute({
    operationId: 'getPost',
    tags: ['posts'],
    summary: 'Get post by ID',
    description: 'Get detailed post info including shader code',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ],
    responses: {
      200: PostDetailResponseSchema,
      404: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  authGuestMiddleware,
  async (c) => {
    const user = c.get('user') ?? { id: 'guest', email: 'guest' }
    console.log('Fetching post detail', { postId: c.req.param('id'), userId: user.id })
    const id = c.req.param('id')
    try {
      const post = await db.query.posts.findFirst({
        where: and(eq(posts.id, id), or(eq(posts.isPublic, true), eq(posts.userId, user.id)), eq(posts.isDeleted, false)),
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

      const vertexKey = `post-file:${id}:vertex`
      const fragmentKey = `post-file:${id}:fragment`
      const [vertexFile, fragmentFile] = await Promise.all([
        redis.get(vertexKey),
        redis.get(fragmentKey),
      ])

      const liked = await db.query.postLikes.findFirst({
        where: and(eq(postLikes.postId, id), eq(postLikes.userId, user.id))
      })

      const isUserLiked = liked ? true : false


      serverLogger.info('Post fetched successfully', { postId: id })
      return c.json({ message: 'Post fetched successfully', post: { ...post, vertex: vertexFile, fragment: fragmentFile, isUserLiked } }, 200)
    } catch (e) {
      serverLogger.error('Failed to fetch post detail', { error: e })
      return c.json({ error: 'Failed to fetch post detail' }, 500)
    }
  }
)

// POST /api/posts - Create a post
postsAPI.post(
  '/',
  describeRoute({
    operationId: 'createPost',
    tags: ['posts'],
    summary: 'Create a new post',
    description: 'Create a new shader post',
    security: [{ Bearer: [] }],
    requestBody: CreatePostRequestSchema,
    responses: {
      201: CreatePostResponseSchema,
      400: ErrorResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  authMiddleware,
  zValidator('json', createPostSchema),
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

// PUT /api/posts/:id/thumbnail - Update a post thumbnail
postsAPI.put(
  '/:id/thumbnail',
  describeRoute({
    operationId: 'updatePostThumbnail',
    tags: ['posts'],
    summary: 'Update post thumbnail',
    description: 'Upload a thumbnail image for a post',
    security: [{ Bearer: [] }],
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ],
    requestBody: {
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            required: ['file'],
            properties: {
              file: { type: 'string', format: 'binary' },
            },
          },
        },
      },
    },
    responses: {
      200: CreatePostResponseSchema,
      400: ErrorResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  zValidator('form', updatePostThumbnailSchema),
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

      const validationResult = validateImageFile(file)
      if (!validationResult.valid) {
        serverLogger.error(validationResult.error ?? 'Invalid image file', { fileType: file.type, fileSize: file.size })
        return c.json({ error: validationResult.error ?? 'Invalid image file.' }, 400)
      }

      const fileExt = getImageExtension(file.type)
      if (!fileExt) {
        serverLogger.error('Invalid file type', { fileType: file.type })
        return c.json({ error: 'Invalid file type. Only JPEG, PNG, and WEBP are allowed.' }, 400)
      }

      const filename = 'thumbnail' + fileExt
      const targetDir = path.join(process.cwd(), 'files', 'posts', id)

      if (!fs.existsSync(targetDir)) {
        await fs.promises.mkdir(targetDir, { recursive: true })
      }

      const savePath = path.join(targetDir, filename)
      const arrayBuffer = await (file as Blob).arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      if (!validateImageMagicNumber(file.type, buffer)) {
        const header = buffer.subarray(0, 12)
        serverLogger.error('Magic number check failed', { fileType: file.type, header: header.toString('hex') })
        return c.json({ error: 'Invalid file content.' }, 400)
      }

      await fs.promises.writeFile(savePath, buffer)

      const picture = `/files/posts/${id}/${filename}`
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
  describeRoute({
    operationId: 'updatePost',
    tags: ['posts'],
    summary: 'Update a post',
    description: 'Update post content and shader code',
    security: [{ Bearer: [] }],
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ],
    requestBody: UpdatePostRequestSchema,
    responses: {
      200: MessageResponseSchema,
      400: ErrorResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  authMiddleware,
  zValidator('json', updatePostSchema),
  async (c) => {
    const id = c.req.param('id')
    const user = c.get('user')

    if (user.status == USER_STATUS.TIMEOUT) {
      serverLogger.error('Forbidden. User is timeout.', { userId: user.id })
      return c.json({ error: 'Forbidden. You are timeout.' }, 403)
    }

    const post = await db.query.posts.findFirst({
      where: eq(posts.id, id)
    })
    if (!post) {
      serverLogger.error('Post not found', { postId: id })
      return c.json({ error: 'Post not found' }, 404)
    }
    if (post.userId !== user.id) {
      serverLogger.error('Forbidden. You do not have permission to update this post.', { userId: user.id, postId: id })
      return c.json({ error: 'Forbidden. You do not have permission to update this post.' }, 403)
    }

    const { title, context, vertex, fragment } = c.req.valid('json')
    const uploadedRedisFiles: string[] = []

    console.log(title)

    const sanitizedTitle = title
    try {
      console.log(context)
      const sanitizedContext = await unified()
        .use(rehypeParse)
        .use(rehypeSanitize)
        .use(rehypeRemark)
        .use(remarkStringify)
        .process(context)
      console.log(sanitizedContext)

      let error: GlslSyntaxError | undefined;

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
      }

      if (fragment) {
        try {
          parse(fragment)
        } catch (e) {
          error = e as GlslSyntaxError
        }

        if (error) {
          serverLogger.error('Invalid GLSL syntax', { error })
          return c.json({ error: 'Invalid GLSL syntax' }, 400)
        }
      }

      try {
        await db.transaction(async (tx) => {
          await tx.update(posts)
            .set({
              title: sanitizedTitle,
              context: String(sanitizedContext ?? ''),
              updatedAt: new Date()
            })
            .where(eq(posts.id, id))



          const vertexKey = `post-file:${id}:vertex`
          const fragmentKey = `post-file:${id}:fragment`


          if (vertex) {

            const oldVertex = await redis.get(vertexKey)
            if (oldVertex) {
              await redis.del(vertexKey)
            }
            await redis.set(vertexKey, vertex)
            uploadedRedisFiles.push(vertexKey)
          }

          if (fragment) {

            const oldFragment = await redis.get(fragmentKey)
            if (oldFragment) {
              await redis.del(fragmentKey)
            }
            await redis.set(fragmentKey, fragment)
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
      serverLogger.error('Failed to update post', { error: e })
      return c.json({ error: 'Failed to update post' }, 500)
    }
  }
)

// PUT /api/posts/:id/publish - Publish a post
postsAPI.put(
  '/posts/:id/publish',
  describeRoute({
    operationId: 'publishPost',
    tags: ['posts'],
    summary: 'Publish a post',
    description: 'Make a post public',
    security: [{ Bearer: [] }],
    parameters: [],
    responses: {
      200: MessageResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },

  }),
  authMiddleware,
  async (c) => {
    const id = c.req.param('id')
    const user = c.get('user')
    const postId = c.req.param('id')

    if (user.status == USER_STATUS.TIMEOUT) {
      serverLogger.error('Forbidden. User is timeout.', { userId: user.id })
      return c.json({ error: 'Forbidden. You are timeout.' }, 403)
    }

    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId)
    })

    if (!post) {
      serverLogger.error('Post not found', { postId })
      return c.json({ error: 'Post not found' }, 404)
    }

    if (post.userId !== user.id) {
      serverLogger.error('Forbidden. You do not have permission to publish this post.', { userId: user.id, postId })
      return c.json({ error: 'Forbidden. You do not have permission to publish this post.' }, 403)
    }

    try {
      await db.update(posts)
        .set({
          isPublic: true,
          updatedAt: new Date()
        })
        .where(eq(posts.id, postId))
        .returning()
    } catch (e) {
      serverLogger.error('Failed to publish post', { error: e })
      return c.json({ error: 'Failed to publish post' }, 500)
    }

    serverLogger.info('Post published successfully', { postId })
    return c.json({ message: 'Post published successfully' }, 200)
  }
)

// PUT /api/posts/like/:id - Like a post
postsAPI.put(
  '/like/:id',
  describeRoute({
    operationId: 'likePost',
    tags: ['posts'],
    summary: 'Like a post',
    description: 'Increment the like count of a post',
    security: [{ Bearer: [] }],
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ],
    responses: {
      200: MessageResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  authMiddleware,
  async (c) => {
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

      const like = await db.query.postLikes.findFirst({
        where: eq(postLikes.userId, user.id)
      })
      if (like) {
        await db.delete(postLikes)
          .where(eq(postLikes.userId, user.id))
          .returning()
        await db.update(posts)
          .set({
            like: post.like - 1
          })
          .where(eq(posts.id, id))
          .returning()
      } else {
        await db.insert(postLikes)
          .values({
            userId: user.id,
            postId: id
          })
          .returning()
        await db.update(posts)
          .set({
            like: post.like + 1
          })
          .where(eq(posts.id, id))
          .returning()
      }

      serverLogger.info('Post liked successfully', { postId: id })
      return c.json({ message: 'Post liked successfully' }, 200)
    } catch (e) {
      serverLogger.error('Failed to fetch post for like', { error: e })
      return c.json({ error: 'Failed to like post' }, 500)
    }
  }
)

// PUT /api/posts/dislike/:id - Dislike a post
postsAPI.put(
  '/dislike/:id',
  describeRoute({
    operationId: 'dislikePost',
    tags: ['posts'],
    summary: 'Dislike a post',
    description: 'Toggle dislike on a post',
    security: [{ Bearer: [] }],
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ],
    responses: {
      200: MessageResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  authMiddleware,
  async (c) => {
    const id = c.req.param('id')
    const user = c.get('user')

    if (user.status == USER_STATUS.TIMEOUT) {
      serverLogger.error('Forbidden. User is timeout.', { userId: user.id })
      return c.json({ error: 'Forbidden. You are timeout.' }, 403)
    }

    try {
      const post = await db.query.posts.findFirst({
        where: eq(posts.id, id)
      })
      if (!post) {
        serverLogger.error('Post not found', { postId: id })
        return c.json({ error: 'Post not found' }, 404)
      }


      const [updatedPost] = await db.update(posts)
        .set({
          dislike: post.dislike + 1
        })
        .where(eq(posts.id, id))
        .returning()

      const dislike = await db.query.postDislikes.findFirst({
        where: eq(postDislikes.userId, user.id)
      })
      if (dislike) {
        await db.delete(postDislikes)
          .where(eq(postDislikes.userId, user.id))
          .returning()
        await db.update(posts)
          .set({
            dislike: post.dislike - 1
          })
          .where(eq(posts.id, id))
          .returning()
      } else {
        await db.insert(postDislikes)
          .values({
            userId: user.id,
            postId: id
          })
          .returning()
        await db.update(posts)
          .set({
            dislike: post.dislike + 1
          })
          .where(eq(posts.id, id))
          .returning()
      }

      serverLogger.info('Post disliked successfully', { postId: id })
      return c.json({ message: 'Post disliked successfully' }, 200)
    } catch (e) {
      serverLogger.error('Failed to fetch post for dislike', { error: e })
      return c.json({ error: 'Failed to dislike post' }, 500)
    }
  }
)

// DELETE /api/posts/:id - Delete a post
postsAPI.delete(
  '/:id',
  describeRoute({
    operationId: 'deletePost',
    tags: ['posts'],
    summary: 'Delete a post',
    description: 'Delete a post by ID',
    security: [{ Bearer: [] }],
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ],
    responses: {
      200: MessageResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  authMiddleware,
  async (c) => {
    const id = c.req.param('id')
    const user = c.get('user')

    const post = await db.query.posts.findFirst({
      where: eq(posts.id, id)
    })
    if (!post) return c.json({ error: 'Post not found' }, 404)

    if (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.MODERATOR && post.userId !== user.id) {
      return c.json({ error: 'Forbidden. You do not have permission to delete this post.' }, 403)
    }

    try {
      const fileKeys = await redis.keys(`post-file:${id}:*`)
      if (fileKeys.length > 0) {
        await redis.del(...fileKeys)
      }

      // await db.delete(posts).where(eq(posts.id, id))
      await db.update(posts)
        .set({
          isDeleted: true,
          updatedAt: new Date()
        })
        .where(eq(posts.id, id))
      serverLogger.info('Post deleted successfully', { postId: id })
      return c.json({ message: 'Post deleted' }, 200)
    } catch (e) {
      serverLogger.error('Failed to delete post', { error: e })
      return c.json({ error: 'Failed to delete post' }, 500)
    }
  }
)

// PATCH /api/posts/:id/restore - Restore a post
postsAPI.patch(
  '/:id/restore',
  describeRoute({
    operationId: 'restorePost',
    tags: ['posts'],
    summary: 'Restore a post',
    description: 'Restore a deleted post by ID',
    security: [{ Bearer: [] }],
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ],
    responses: {
      200: MessageResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  authMiddleware,
  async (c) => {
    const id = c.req.param('id')
    const user = c.get('user')

    const post = await db.query.posts.findFirst({
      where: eq(posts.id, id)
    })
    if (!post) return c.json({ error: 'Post not found' }, 404)

    if (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.MODERATOR && post.userId !== user.id) {
      return c.json({ error: 'Forbidden. You do not have permission to restore this post.' }, 403)
    }

    try {
      const fileKeys = await redis.keys(`post-file:${id}:*`)
      if (fileKeys.length > 0) {
        await redis.del(...fileKeys)
      }

      // await db.delete(posts).where(eq(posts.id, id))
      await db.update(posts)
        .set({
          isDeleted: false,
          updatedAt: new Date()
        })
        .where(eq(posts.id, id))
      serverLogger.info('Post restored successfully', { postId: id })
      return c.json({ message: 'Post restored' }, 200)
    } catch (e) {
      serverLogger.error('Failed to restore post', { error: e })
      return c.json({ error: 'Failed to restore post' }, 500)
    }
  }
)

export default postsAPI
