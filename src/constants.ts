export const USER_ROLES = {
  ADMIN: 'admin',
  ORGANIZER: 'organizer',
  USER: 'user',
} as const;

export const EVENT_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  CANCELLED: 'cancelled',
} as const;

export const TICKET_STATUS = {
  VALID: 'valid',
  USED: 'used',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
} as const;

export const PAYMENT_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export const ARGON2_OPTIONS = {
  memoryCost: 16384,
  parallelism: 2,
  timeCost: 3,
} as const;

export const PASSWORD_MIN_LENGTH = 8;

export type UserRole = typeof USER_ROLES[keyof typeof USER_ROLES];
export type EventStatus = typeof EVENT_STATUS[keyof typeof EVENT_STATUS];
export type TicketStatus = typeof TICKET_STATUS[keyof typeof TICKET_STATUS];
export type PaymentStatus = typeof PAYMENT_STATUS[keyof typeof PAYMENT_STATUS];
