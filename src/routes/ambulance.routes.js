/**
 * Ambulance routes: /api/ambulance/*. Auth + Ambulance role required.
 */
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import {
  getDashboard,
  updateStatus,
  acceptTrip,
  rejectTrip,
  startTrip,
  arrivedTrip,
  patientPickedTrip,
  completeTrip,
} from '../controllers/ambulance.controller.js';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('Ambulance'));

router.get('/dashboard', getDashboard);
router.patch('/status', updateStatus);
router.post('/requests/:id/accept', acceptTrip);
router.post('/requests/:id/reject', rejectTrip);
router.patch('/requests/:id/start', startTrip);
router.patch('/requests/:id/arrived', arrivedTrip);
router.patch('/requests/:id/patient-picked', patientPickedTrip);
router.patch('/requests/:id/complete', completeTrip);

export default router;
