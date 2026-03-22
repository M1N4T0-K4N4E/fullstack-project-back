import { Hono } from 'hono';
import { Google, generateState, generateCodeVerifier } from 'arctic';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { setCookie, getCookie } from 'hono/cookie';
import * as jose from 'jose';

const auth = new Hono();

const google = new Google(
  process.env.GOOGLE_CLIENT_ID!,
  process.env.GOOGLE_CLIENT_SECRET!,
  'http://localhost:3000/api/auth/google/callback'
);

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

auth.get('/google', async (c) => {
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

auth.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const storedState = getCookie(c, 'google_oauth_state');
  const codeVerifier = getCookie(c, 'google_code_verifier');

  if (!code || !state || state !== storedState || !codeVerifier) {
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

    if (!existingUser) {
      const [newUser] = await db.insert(users).values({
        googleId: googleUser.sub,
        email: googleUser.email,
        name: googleUser.name,
        avatarUrl: googleUser.picture
      }).returning({ id: users.id });
      userId = newUser.id;
    } else {
      userId = existingUser.id;
    }

    // Generate JWT
    const jwt = await new jose.SignJWT({ sub: userId, email: googleUser.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('2h')
      .sign(secret);

    // Redirect to frontend with token
    return c.redirect(`${process.env.FRONTEND_URL}/auth-success?token=${jwt}`);
  } catch (error) {
    console.error('OAuth error:', error);
    return c.json({ error: 'Authentication failed' }, 500);
  }
});

auth.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.split(' ')[1];

  try {
    const { payload } = await jose.jwtVerify(token, secret);
    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.sub as string)
    });
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }
    return c.json(user);
  } catch (e) {
    return c.json({ error: 'Invalid token' }, 401);
  }
});

export default auth;
