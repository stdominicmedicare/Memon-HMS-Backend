/**
 * Rate limiting for brute-force / abuse protection.
 */
import rateLimit from 'express-rate-limit';

/** General API cap (authenticated traffic). */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again later.', code: 'RATE_LIMITED' },
});

/**
 * Stricter cap for sensitive auth endpoints (change-password, etc.).
 * Login itself is handled by Supabase Auth; this covers our Express auth routes.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Try again later.', code: 'RATE_LIMITED' },
});
