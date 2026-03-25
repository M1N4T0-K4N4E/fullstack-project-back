export const USER_ROLES = {
  ADMIN: 'admin',
  MODERATOR: 'moderator',
  USER: 'user',
} as const;

export const USER_STATUS = {
  ACTIVE: 'active',
  TIMEOUT: 'timed_out',
  BANNED: 'banned',
} as const;

export const ARGON2_OPTIONS = {
  memoryCost: 32768,
  parallelism: 2,
  timeCost: 3,
} as const;

export const JWT_EXPIRATION = {
  ACCESS_TOKEN: '15m',
  REFRESH_TOKEN: '7d',
  REFRESH_TOKEN_REDIS: 7 * 24 * 60 * 60, // 7 days in seconds
} as const;

export const PASSWORD_MIN_LENGTH = 15;

export type UserRole = typeof USER_ROLES[keyof typeof USER_ROLES];
export type UserStatus = typeof USER_STATUS[keyof typeof USER_STATUS];
