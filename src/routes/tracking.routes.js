/**
 * Tracking routes: start, update-status, location, stop. Ambulance driver only.
 */
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import {
  startTracking,
  updateTrackingStatus,
  recordLocation,
  stopTracking,
} from '../controllers/tracking.controller.js';

const router = Router();
router.use(authMiddleware);
router.use(requireRole('Ambulance'));

router.post('/start', startTracking);
router.post('/update-status', updateTrackingStatus);
router.post('/location', recordLocation);
router.post('/stop', stopTracking);

export default router;
