/**
 * Helpers for reading JWT claims used by auth gates.
 */

/** Decode JWT payload without verifying (token already verified via supabase.auth.getUser). */
export function decodeJwtPayload(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Supabase MFA assurance level: aal1 (password) or aal2 (MFA verified). */
export function getAalFromToken(token) {
  const payload = decodeJwtPayload(token);
  const aal = payload?.aal;
  return aal === 'aal2' ? 'aal2' : 'aal1';
}
