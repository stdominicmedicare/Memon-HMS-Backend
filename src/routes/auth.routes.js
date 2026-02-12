/**
 * Auth routes: current user profile (no role required).
 * Used by frontend to load profile without relying on Supabase RLS from the client.
 */
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);

/** GET /api/auth/me – current user's profile (id, email, role, full_name). */
router.get('/me', (req, res) => {
  res.json(req.profile || {});
});

export default router;
