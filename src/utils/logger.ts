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

// Middleware to log all API requests as user/guest interactions
export const userInteractionLogger: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  
  await next();
  
  const ms = Date.now() - start;
  const method = c.req.method;
  const path = new URL(c.req.url).pathname; // use pathname for cleaner logs
  const status = c.res.status;
  
  // Get user info if authenticated
  const user = c.get('user');
  const userId = user?.id || 'guest';
  const userEmail = user?.email || 'none';
  
  const ip = c.req.header('x-forwarded-for') || 'unknown';
  const userAgent = c.req.header('user-agent') || 'unknown';

  const logContext = {
    userId,
    userEmail,
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
