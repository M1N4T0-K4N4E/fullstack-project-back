import { Hono } from 'hono';
import { serverLogger } from '../utils/logger.js';
import { Google, generateState, generateCodeVerifier } from 'arctic';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { authMiddleware, type Variables } from '../middleware/auth.js';
import { setCookie, getCookie } from 'hono/cookie';
import * as jose from 'jose';
import argon2 from 'argon2';
import { ARGON2_OPTIONS, JWT_EXPIRATION, PASSWORD_MIN_LENGTH } from '../constants.js';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import redis from '../utils/redis.js';
import { v4 as uuidv4 } from 'uuid';
import { describeRoute } from 'hono-openapi';
import type { OpenAPIV3_1 } from 'openapi-types';

const authAPI = new Hono<{ Variables: Variables }>();

const google = new Google(
  process.env.GOOGLE_CLIENT_ID!,
  process.env.GOOGLE_CLIENT_SECRET!,
  process.env.GOOGLE_CALLBACK_API!
);

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

// Zod Schemas for validation
const registerSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`),
  name: z.string().min(1, 'Name is required'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
});

const googleCallbackSchema = z.object({
  code: z.string().min(1, 'Code is required'),
  state: z.string().min(1, 'State is required'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

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

const RegisterRequestSchema: OpenAPIV3_1.RequestBodyObject = {
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['email', 'password', 'name'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: PASSWORD_MIN_LENGTH },
          name: { type: 'string', minLength: 1 },
        },
      },
    },
  },
};

const RegisterResponseSchema: OpenAPIV3_1.ResponseObject = {
  description: 'User registered successfully',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          token: { type: 'string' },
          refreshToken: { type: 'string' },
        },
      },
    },
  },
};

const LoginRequestSchema: OpenAPIV3_1.RequestBodyObject = {
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
        },
      },
    },
  },
};

const LoginResponseSchema: OpenAPIV3_1.ResponseObject = {
  description: 'Login successful',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          token: { type: 'string' },
          refreshToken: { type: 'string' },
        },
      },
    },
  },
};

const TokenRefreshRequestSchema: OpenAPIV3_1.RequestBodyObject = {
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string' },
        },
      },
    },
  },
};

const TokenRefreshResponseSchema: OpenAPIV3_1.ResponseObject = {
  description: 'Token refreshed successfully',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          token: { type: 'string' },
        },
      },
    },
  },
};

const LogoutRequestSchema: OpenAPIV3_1.RequestBodyObject = {
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          refreshToken: { type: 'string' },
        },
      },
    },
  },
};

const LogoutResponseSchema: OpenAPIV3_1.ResponseObject = {
  description: 'Logged out successfully',
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

const UserResponseSchema: OpenAPIV3_1.ResponseObject = {
  description: 'Current user',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: ['string', 'null'] },
          name: { type: ['string', 'null'] },
          role: { type: ['string', 'null'] },
        },
      },
    },
  },
};

const generateTokens = async (user: { id: string, email: string | null, name: string | null, role: string | null }) => {
  const jti = uuidv4();

  const accessToken = await new jose.SignJWT({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRATION.ACCESS_TOKEN)
    .sign(secret);

  const refreshToken = await new jose.SignJWT({
    sub: user.id,
    jti
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRATION.REFRESH_TOKEN)
    .sign(secret);

  await redis.set(`refresh_token:${jti}`, user.id, 'EX', JWT_EXPIRATION.REFRESH_TOKEN_REDIS);

  return { accessToken, refreshToken };
};

// Email/Password Register
authAPI.post(
  '/register',
  describeRoute({
    operationId: 'register',
    tags: ['auth'],
    summary: 'Register a new user',
    description: 'Register a new user with email and password',
    requestBody: RegisterRequestSchema,
    responses: {
      201: RegisterResponseSchema,
      400: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  zValidator('json', registerSchema),
  async (c) => {
    try {
      const { email, password, name } = c.req.valid('json');

      const existingUser = await db.query.users.findFirst({
        where: eq(users.email, email)
      });

      if (existingUser) {
        serverLogger.error('User already exists', { userEmail: email });
        return c.json({ error: 'User already exists' }, 400);
      }

      const hashedPassword = await argon2.hash(password, ARGON2_OPTIONS);

      const newUser = await db.insert(users).values({
        email,
        password: hashedPassword,
        name,
      }).returning();

      const { accessToken, refreshToken } = await generateTokens({
        id: newUser[0].id,
        email: newUser[0].email,
        name: newUser[0].name,
        role: newUser[0].role
      });

      serverLogger.info('User registered successfully', { userEmail: newUser[0].email, userName: newUser[0].name });
      return c.json({
        message: 'User registered successfully',
        token: accessToken,
        refreshToken
      }, 201);
    } catch (error) {
      serverLogger.error('Registration error', { error });
      return c.json({ error: 'Registration failed' }, 500);
    }
  }
);

// Email/Password Login
authAPI.post(
  '/login',
  describeRoute({
    operationId: 'login',
    tags: ['auth'],
    summary: 'Login user',
    description: 'Login with email and password',
    requestBody: LoginRequestSchema,
    responses: {
      200: LoginResponseSchema,
      401: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  zValidator('json', loginSchema),
  async (c) => {
    try {
      const { email, password } = c.req.valid('json');

      const user = await db.query.users.findFirst({
        where: eq(users.email, email)
      });

      if (!user || !user.password) {
        return c.json({ error: 'Invalid credentials' }, 401);
      }

      const isValid = await argon2.verify(user.password, password);
      if (!isValid) {
        return c.json({ error: 'Invalid credentials' }, 401);
      }

      const { accessToken, refreshToken } = await generateTokens({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      });

      serverLogger.info('User logged in successfully', { userEmail: user.email, userName: user.name });
      return c.json({
        message: 'Login successful',
        token: accessToken,
        refreshToken
      }, 200);
    } catch (error) {
      serverLogger.error('Login error', { error });
      return c.json({ error: 'Login failed' }, 500);
    }
  }
);

authAPI.get(
  '/google',
  describeRoute({
    operationId: 'googleAuth',
    tags: ['auth'],
    summary: 'Google OAuth login',
    description: 'Redirect to Google OAuth consent screen',
    responses: {
      302: {
        description: 'Redirect to Google',
      },
    },
  }),
  async (c) => {
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const url = await google.createAuthorizationURL(state, codeVerifier, ['profile', 'email']);

    setCookie(c, 'google_oauth_state', state, {
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 600,
      sameSite: 'Lax'
    });

    setCookie(c, 'google_code_verifier', codeVerifier, {
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 600,
      sameSite: 'Lax'
    });

    return c.redirect(url.toString());
  }
);

authAPI.get(
  '/google/callback',
  describeRoute({
    operationId: 'googleCallback',
    tags: ['auth'],
    summary: 'Google OAuth callback',
    description: 'Handle Google OAuth callback and issue JWT',
    parameters: [
      {
        name: 'code',
        in: 'query',
        required: true,
        schema: { type: 'string' },
      },
      {
        name: 'state',
        in: 'query',
        required: true,
        schema: { type: 'string' },
      },
    ],
    responses: {
      302: {
        description: 'Redirect with tokens',
      },
      400: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  zValidator('query', googleCallbackSchema),
  async (c) => {
    const { code, state } = c.req.valid('query');
    const storedState = getCookie(c, 'google_oauth_state');
    const codeVerifier = getCookie(c, 'google_code_verifier');

    if (state !== storedState || !codeVerifier) {
      return c.json({ error: 'Invalid state or code' }, 400);
    }

    try {
      const tokens = await google.validateAuthorizationCode(code, codeVerifier);
      const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: {
          Authorization: `Bearer ${tokens.accessToken()}`
        }
      });
      const googleUser = await response.json() as { sub: string, email: string, name: string, picture: string };

      const existingUser = await db.query.users.findFirst({
        where: eq(users.googleId, googleUser.sub)
      });

      const user: string[] = [];

      if (!existingUser) {
        const [newUser] = await db.insert(users).values({
          googleId: googleUser.sub,
          email: googleUser.email,
          name: googleUser.name,
          avatarUrl: googleUser.picture
        }).returning();
        user.push(newUser.id, newUser.email, newUser.name, newUser.role);
      } else {
        user.push(existingUser.id, existingUser.email, existingUser.name, existingUser.role);
      }

      const { accessToken, refreshToken } = await generateTokens({
        id: user[0],
        email: user[1],
        name: user[2],
        role: user[3]
      });

      serverLogger.info('User logged in successfully', { userEmail: user[1], userName: user[2] });
      return c.redirect(`${process.env.FRONTEND_URL}/auth-success?token=${accessToken}&refreshToken=${refreshToken}`);
    } catch (error) {
      serverLogger.error('OAuth error', { error });
      return c.json({ error: 'Authentication failed' }, 500);
    }
  }
);

authAPI.get(
  '/me',
  describeRoute({
    operationId: 'getMe',
    tags: ['auth'],
    summary: 'Get current user',
    description: 'Get the currently authenticated user',
    security: [{ Bearer: [] }],
    responses: {
      200: UserResponseSchema,
      401: ErrorResponseSchema,
    },
  }),
  authMiddleware,
  async (c) => {
    return c.json(c.get('user'));
  }
);

authAPI.post(
  '/logout',
  describeRoute({
    operationId: 'logout',
    tags: ['auth'],
    summary: 'Logout user',
    description: 'Invalidate the current access token',
    security: [{ Bearer: [] }],
    requestBody: LogoutRequestSchema,
    responses: {
      200: LogoutResponseSchema,
      500: ErrorResponseSchema,
    },
  }),
  authMiddleware,
  async (c) => {
    const token = c.get('token');
    const body = await c.req.json().catch(() => ({}));
    const refreshToken = body.refreshToken;

    try {
      await redis.set(token, 'true', 'EX', 12 * 60 * 60);

      if (refreshToken) {
        try {
          const { payload } = await jose.jwtVerify(refreshToken, secret);
          const jti = payload.jti;
          if (jti) {
            await redis.del(`refresh_token:${jti}`);
          }
        } catch (e) {
          // Refresh token might be expired or invalid, just ignore
        }
      }

      return c.json({ message: 'Logged out successfully' }, 200);
    } catch (error) {
      serverLogger.error('Logout error', { error });
      return c.json({ error: 'Logout failed' }, 500);
    }
  }
);

authAPI.post(
  '/refresh',
  describeRoute({
    operationId: 'refreshToken',
    tags: ['auth'],
    summary: 'Refresh access token',
    description: 'Get a new access token using refresh token',
    requestBody: TokenRefreshRequestSchema,
    responses: {
      200: TokenRefreshResponseSchema,
      401: ErrorResponseSchema,
      404: ErrorResponseSchema,
    },
  }),
  zValidator('json', refreshSchema),
  async (c) => {
    const { refreshToken } = c.req.valid('json');

    try {
      const { payload } = await jose.jwtVerify(refreshToken, secret);
      const userId = payload.sub as string;
      const jti = payload.jti as string;

      if (!userId || !jti) {
        return c.json({ error: 'Invalid refresh token' }, 401);
      }

      const storedUserId = await redis.get(`refresh_token:${jti}`);
      if (!storedUserId || storedUserId !== userId) {
        return c.json({ error: 'Refresh token expired or invalid' }, 401);
      }

      const user = await db.query.users.findFirst({
        where: eq(users.id, userId)
      });

      if (!user) {
        return c.json({ error: 'User not found' }, 404);
      }

      const accessToken = await new jose.SignJWT({
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(JWT_EXPIRATION.ACCESS_TOKEN)
        .sign(secret);

      serverLogger.info('Token refreshed successfully', { userEmail: user.email, userName: user.name });
      return c.json({ message: 'Token refreshed successfully', token: accessToken }, 200);
    } catch (error) {
      serverLogger.error('Refresh token error', { error });
      return c.json({ error: 'Invalid refresh token' }, 401);
    }
  }
);

export default authAPI;
