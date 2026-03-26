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
    const metaStr = Object.assign({}, metadata);
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

const inferUserAction = (method: string, path: string): string => {
  if (method === 'POST' && path === '/api/posts') return 'create_post';
  if (method === 'PUT' && /^\/api\/posts\/like\/.+/.test(path)) return 'like_post';
  if (method === 'PUT' && /^\/api\/posts\/dislike\/.+/.test(path)) return 'dislike_post';
  if (method === 'PUT' && path === '/api/account') return 'update_account';
  if (method === 'PUT' && path === '/api/account/password') return 'change_password';
  if (method === 'POST' && /^\/api\/auth\/register$/.test(path)) return 'register';
  if ((method === 'POST' || method === 'GET') && /^\/api\/auth\/(login|google)$/.test(path)) return 'login';
  if (method === 'POST' && path === '/api/auth/logout') return 'logout';
  if (method === 'POST' && path === '/api/auth/refresh') return 'refresh_token';
  if (method === 'PUT' && /^\/api\/posts\/.+\/thumbnail$/.test(path)) return 'update_post_thumbnail';
  if (method === 'PUT' && /^\/api\/posts\/.+/.test(path)) return 'update_post';
  if (method === 'DELETE' && /^\/api\/posts\/.+/.test(path)) return 'delete_post';
  if (method === 'GET' && path.startsWith('/api/posts')) return 'view_posts';
  if (method === 'GET' && path.startsWith('/api/account')) return 'view_account';
  if (method === 'GET' && path.startsWith('/api/users')) return 'view_users';
  if (method === 'GET' && path === '/api/logs/user') return 'view_user_logs';
  if (method === 'GET' && path === '/api/logs/server') return 'view_server_logs';
  if (method === 'GET' && path === '/api/logs/files') return 'view_log_files';
  if (method === 'GET' && /^\/api\/logs\/files\/.+/.test(path)) return 'view_log_file_content';
  if (method === 'POST' && path === '/api/account/ban') return 'ban_user';
  if (method === 'GET' && path === '/scalar') return 'view_api_doc';
  if (method === 'GET' && path === '/doc') return 'view_api_doc';
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
