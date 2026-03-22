export const USER_ROLES = {
  ADMIN: 'admin',
  ORGANIZER: 'organizer',
  USER: 'user',
} as const;

export const TICKET_STATUS = {
  PURCHASED: 'purchased',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
} as const;

export const PAYMENT_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type UserRole = typeof USER_ROLES[keyof typeof USER_ROLES];
export type TicketStatus = typeof TICKET_STATUS[keyof typeof TICKET_STATUS];
export type PaymentStatus = typeof PAYMENT_STATUS[keyof typeof PAYMENT_STATUS];
