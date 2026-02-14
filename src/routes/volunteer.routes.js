/**
 * Volunteer routes: /api/volunteer/*. Auth + Volunteer role required.
 */
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import {
  getProfile,
  updateAvailability,
  getDonationRequests,
  acceptDonationRequest,
  getMyDonations,
} from '../controllers/volunteer.controller.js';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('Volunteer'));

router.get('/profile', getProfile);
router.patch('/availability', updateAvailability);
router.get('/donation-requests', getDonationRequests);
router.post('/donation-requests/:id/accept', acceptDonationRequest);
router.get('/donations', getMyDonations);

export default router;
