/**
 * Shared password strength rules for create/reset/signup.
 * Min 10 chars, upper + lower + digit + special. Expiry: 90 days.
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_EXPIRY_DAYS = 90;

const SPECIAL_RE = /[^A-Za-z0-9]/;

/**
 * @param {string} password
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { ok: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    };
  }
  if (!/[a-z]/.test(password)) {
    return { ok: false, error: 'Password must include a lowercase letter' };
  }
  if (!/[A-Z]/.test(password)) {
    return { ok: false, error: 'Password must include an uppercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { ok: false, error: 'Password must include a number' };
  }
  if (!SPECIAL_RE.test(password)) {
    return { ok: false, error: 'Password must include a special character (e.g. !@#$%)' };
  }
  return { ok: true };
}

/**
 * @param {string|null|undefined} passwordChangedAt ISO timestamp
 * @returns {boolean}
 */
export function isPasswordExpired(passwordChangedAt) {
  if (!passwordChangedAt) return false;
  const changed = new Date(passwordChangedAt).getTime();
  if (Number.isNaN(changed)) return false;
  const maxAgeMs = PASSWORD_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - changed > maxAgeMs;
}
