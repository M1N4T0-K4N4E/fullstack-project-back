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
import { ARGON2_OPTIONS, USER_ROLES } from '../constants.js';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import redis from '../utils/redis.js';

const authAPI = new Hono<{ Variables: Variables }>();

const google = new Google(
  process.env.GOOGLE_CLIENT_ID!,
  process.env.GOOGLE_CLIENT_SECRET!,
  process.env.GOOGLE_CALLBACK_API!
);

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

const registerSchema = z.object({
  email: z.email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  name: z.string().min(1, 'Name is required'),
});

const loginSchema = z.object({
  email: z.email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
});

const googleCallbackSchema = z.object({
  code: z.string().min(1, 'Code is required'),
  state: z.string().min(1, 'State is required'),
});

// Email/Password Register
authAPI.post('/register', zValidator('json', registerSchema), async (c) => {
  try {
    const { email, password, name } = c.req.valid('json');

    // Check if user exists
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email)
    });

    if (existingUser) {
      return c.json({ error: 'User already exists' }, 400);
    }

    // Hash password
    const hashedPassword = await argon2.hash(password, ARGON2_OPTIONS);

    // Create user
    const newUser = await db.insert(users).values({
      email,
      password: hashedPassword,
      name,
    }).returning();

    const jwt = await new jose.SignJWT({ sub: newUser[0].id, email: newUser[0].email, name: newUser[0].name, role: newUser[0].role })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(secret);

    serverLogger.info('User registered successfully', { userEmail: newUser[0].email, userName: newUser[0].name });
    return c.json({ message: 'User registered successfully', token: jwt }, 201);
  } catch (error) {
    serverLogger.error('Registration error', { error });
    return c.json({ error: 'Registration failed' }, 500);
  }
});

// Email/Password Login
authAPI.post('/login', zValidator('json', loginSchema), async (c) => {
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

    const jwt = await new jose.SignJWT({ sub: user.id, email: user.email, name: user.name, role: user.role})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(secret);

    return c.json({ token: jwt, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (error) {
    serverLogger.error('Login error', { error });
    return c.json({ error: 'Login failed' }, 500);
  }
});

authAPI.get('/google', async (c) => {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = await google.createAuthorizationURL(state, codeVerifier, ['profile', 'email']);
  
  setCookie(c, 'google_oauth_state', state, {
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 600, // 10 minutes
    sameSite: 'Lax'
  });
  
  setCookie(c, 'google_code_verifier', codeVerifier, {
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 600, // 10 minutes
    sameSite: 'Lax'
  });

  return c.redirect(url.toString());
});

authAPI.get('/google/callback', zValidator('query', googleCallbackSchema), async (c) => {
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

    // Find or create user
    const existingUser = await db.query.users.findFirst({
      where: eq(users.googleId, googleUser.sub)
    });

    let userId: string;
    let tokenVersion = 1;

    if (!existingUser) {
      const [newUser] = await db.insert(users).values({
        googleId: googleUser.sub,
        email: googleUser.email,
        name: googleUser.name,
        avatarUrl: googleUser.picture
      }).returning({ id: users.id});
      userId = newUser.id;
    } else {
      userId = existingUser.id;
    }

    // Generate JWT
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId)
    });
    const jwt = await new jose.SignJWT({ sub: userId, email: user?.email, name: user?.name, role: user?.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(secret);

    // Redirect to frontend with token
    return c.redirect(`${process.env.FRONTEND_URL}/auth-success?token=${jwt}`);
  } catch (error) {
    serverLogger.error('OAuth error', { error });
    return c.json({ error: 'Authentication failed' }, 500);
  }
});

authAPI.get('/me', authMiddleware, async (c) => {
  return c.json(c.get('user'));
});

// Add token to redis blacklist with 12 hour expiration (43200 seconds)
authAPI.post('/logout', authMiddleware, async (c) => {
  const token = c.get('token');

  try {
    await redis.set(token, 'true', 'EX', 12 * 60 * 60);
    
    return c.json({ message: 'Logged out successfully' });
  } catch (error) {
    serverLogger.error('Logout error', { error });
    return c.json({ error: 'Logout failed' }, 500);
  }
});


export default authAPI;
