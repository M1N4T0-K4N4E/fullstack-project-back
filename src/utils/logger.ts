import winston from 'winston';
import 'winston-daily-rotate-file';
import type { MiddlewareHandler } from 'hono';
import Transport from 'winston-transport';
import { db } from '../db/index.js';
import { serverLogs, userInteractions } from '../db/schema.js';

const { combine, timestamp, printf, colorize, json } = winston.format;

winston.addColors({
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
});

const consoleFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `[${timestamp}] ${level}: ${message}`;
  if (Object.keys(metadata).length > 0 && metadata.message !== message) {
    // avoid duplicating message if it's both a property and log text
    const metaStr = { ...metadata };
    delete metaStr.splat;
    if (Object.keys(metaStr).length > 0) {
      msg += ` ${JSON.stringify(metaStr)}`;
    }
  }
  return msg;
});

// Logging to Database
class DrizzleServerTransport extends Transport {
  constructor(opts?: Transport.TransportStreamOptions) {
    super(opts);
  }

  log(info: any, callback: () => void) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    const { level, message, timestamp, ...meta } = info;
    
    db.insert(serverLogs).values({
      level,
      message,
      meta: Object.keys(meta).length > 0 ? meta : null
    }).catch(e => {
      console.error('Failed to log to DB:', e);
    });

    callback();
  }
}

// Server Logger File: System events, errors, lifecycle
export const serverLogger = winston.createLogger({
  level: 'info',
  format: combine(timestamp(), json()),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), timestamp(), consoleFormat),
    }),
    new winston.transports.DailyRotateFile({
      dirname: 'logs',
      filename: 'server-error-%DATE%.log',
      level: 'error',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
    }),
    new winston.transports.DailyRotateFile({
      dirname: 'logs',
      filename: 'server-combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
    }),
    new DrizzleServerTransport()
  ],
});

// User Logger File: User/Guest interactions
export const userLogger = winston.createLogger({
  level: 'info',
  format: combine(timestamp(), json()),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), timestamp(), consoleFormat),
    }),
    new winston.transports.DailyRotateFile({
      dirname: 'logs',
      filename: 'user-error-%DATE%.log',
      level: 'error',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
    }),
    new winston.transports.DailyRotateFile({
      dirname: 'logs',
      filename: 'user-combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
    }),
  ],
});

type ActionRule = {
  methods: string[];
  action: string;
  match: (path: string) => boolean;
};

const ACTION_RULES: ActionRule[] = [
  { methods: ['POST'], action: 'create_post', match: (path) => path === '/api/posts' },
  { methods: ['PUT'], action: 'like_post', match: (path) => /^\/api\/posts\/like\/.+/.test(path) },
  { methods: ['PUT'], action: 'dislike_post', match: (path) => /^\/api\/posts\/dislike\/.+/.test(path) },
  { methods: ['PUT'], action: 'update_account', match: (path) => path === '/api/account' },
  { methods: ['PUT'], action: 'change_password', match: (path) => path === '/api/account/password' },
  { methods: ['POST'], action: 'register', match: (path) => path === '/api/auth/register' },
  { methods: ['POST', 'GET'], action: 'login', match: (path) => /^\/api\/auth\/(login|google)$/.test(path) },
  { methods: ['POST'], action: 'logout', match: (path) => path === '/api/auth/logout' },
  { methods: ['POST'], action: 'refresh_token', match: (path) => path === '/api/auth/refresh' },
  { methods: ['PUT'], action: 'update_post_thumbnail', match: (path) => /^\/api\/posts\/.+\/thumbnail$/.test(path) },
  { methods: ['PUT'], action: 'publish_post', match: (path) => /^\/api\/posts\/.+\/publish$/.test(path) },
  { methods: ['PUT'], action: 'update_post', match: (path) => /^\/api\/posts\/.+/.test(path) },
  { methods: ['DELETE'], action: 'delete_post', match: (path) => /^\/api\/posts\/.+/.test(path) },
  { methods: ['PATCH'], action: 'restore_post', match: (path) => /^\/api\/posts\/.+/.test(path) },
  { methods: ['GET'], action: 'view_posts', match: (path) => path.startsWith('/api/posts') },
  { methods: ['GET'], action: 'view_account', match: (path) => path.startsWith('/api/account') },
  { methods: ['GET'], action: 'view_users', match: (path) => path.startsWith('/api/users') },
  { methods: ['GET'], action: 'view_user_logs', match: (path) => path === '/api/logs/user' },
  { methods: ['GET'], action: 'view_server_logs', match: (path) => path === '/api/logs/server' },
  { methods: ['GET'], action: 'view_log_files', match: (path) => path === '/api/logs/files' },
  { methods: ['GET'], action: 'view_log_file_content', match: (path) => /^\/api\/logs\/files\/.+/.test(path) },
  { methods: ['POST'], action: 'ban_user', match: (path) => path === '/api/account/ban' },
  { methods: ['GET'], action: 'view_api_doc', match: (path) => path === '/scalar' || path === '/doc' },
];

const inferUserAction = (method: string, path: string): string => {
  const normalizedMethod = method.toUpperCase();
  const normalizedPath = path.length > 1 ? path.replace(/\/+$/, '') : path;

  for (const rule of ACTION_RULES) {
    if (rule.methods.includes(normalizedMethod) && rule.match(normalizedPath)) {
      return rule.action;
    }
  }

  return 'unknown';
};

// Middleware to log all API requests as user/guest interactions
export const userInteractionLogger: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  
  await next();
  
  const ms = Date.now() - start;
  const method = c.req.method;
  const path = new URL(c.req.url).pathname; // use pathname for cleaner logs
  const status = c.res.status;
  const action = inferUserAction(method, path);
  
  // Get user info if authenticated
  const user = c.get('user');
  const userId = user?.id || 'guest';
  const userEmail = user?.email || 'guest';
  const userRole = user?.role || 'guest';
  
  const ip = c.req.header('x-forwarded-for') || 'unknown';
  const userAgent = c.req.header('user-agent') || 'unknown';

  const logContext = {
    userId,
    userEmail,
    userRole,
    action,
    method,
    path,
    status,
    durationMs: ms,
    ip,
    userAgent
  };

  const message = `${method} ${path} [${status}] - ${ms}ms - User: ${userId}`;

  if (status >= 400) {
    userLogger.error(message, logContext);
  } else {
    userLogger.info(message, logContext);
  }
  
  // Save to Database
  try {
    await db.insert(userInteractions).values({
      userId,
      userEmail,
      userRole,
      action,
      method,
      path,
      status,
      durationMs: ms,
      ip,
      userAgent
    });
  } catch (e) {
    // Avoid infinite loop if serverLogger throws by just using native console
    console.error('Failed to insert user interaction to DB:', e);
  }
};
