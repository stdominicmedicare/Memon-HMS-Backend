/**
 * Auth routes: current user profile (no role required).
 * Used by frontend to load profile without relying on Supabase RLS from the client.
 */
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { supabase } from '../config/supabase.js';
import { validatePassword } from '../utils/passwordPolicy.js';

const router = Router();

router.use(authMiddleware);

/** GET /api/auth/me – current user's profile (id, email, role, full_name, password_expired). */
router.get('/me', (req, res) => {
  res.json(req.profile || {});
});

/**
 * POST /api/auth/change-password – authenticated user sets a new password.
 * Updates password_changed_at for expiry tracking.
 */
router.post('/change-password', async (req, res) => {
  try {
    const { password } = req.body || {};
    const check = validatePassword(password);
    if (!check.ok) return res.status(400).json({ error: check.error });

    const { error } = await supabase.auth.admin.updateUserById(req.user.id, { password });
    if (error) return res.status(400).json({ error: error.message });

    const now = new Date().toISOString();
    await supabase
      .from('profiles')
      .update({ password_changed_at: now, updated_at: now })
      .eq('id', req.user.id);

    res.json({ message: 'Password updated', password_changed_at: now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
