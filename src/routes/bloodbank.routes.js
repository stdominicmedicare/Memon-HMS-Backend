/**
 * Blood Bank routes: /api/bloodbank/*.
 * Auth required. Dashboard/inventory/donors/testing/requests: BloodBank or Admin.
 * GET /availability: also Doctor, ICU (view availability).
 */
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import {
  getDashboard,
  getDonors,
  createDonor,
  updateDonor,
  getInventoryByGroup,
  getBloodUnits,
  createBloodUnit,
  updateBloodUnit,
  getUnitsUnderTesting,
  approveUnit,
  rejectUnit,
  getBloodRequests,
  approveRequest,
  rejectRequest,
  allocateRequest,
  recordTransfusion,
  getTransfusionLogs,
  disposeUnit,
  getDisposalLogs,
  getBloodAvailability,
} from '../controllers/bloodbank.controller.js';

const router = Router();

router.use(authMiddleware);

// Doctor and ICU can view blood availability only
router.get('/availability', requireRole('BloodBank', 'Admin', 'Doctor', 'ICU', 'Blood Bank'), getBloodAvailability);

// All other routes: Blood Bank Staff or Admin
router.use(requireRole('BloodBank', 'Admin', 'Blood Bank'));

router.get('/dashboard', getDashboard);
router.get('/donors', getDonors);
router.post('/donors', createDonor);
router.patch('/donors/:id', updateDonor);
router.get('/inventory', getInventoryByGroup);
router.get('/units', getBloodUnits);
router.post('/units', createBloodUnit);
router.patch('/units/:id', updateBloodUnit);
router.get('/testing', getUnitsUnderTesting);
router.post('/units/:id/approve', approveUnit);
router.post('/units/:id/reject', rejectUnit);
router.get('/requests', getBloodRequests);
router.post('/requests/:id/approve', approveRequest);
router.post('/requests/:id/reject', rejectRequest);
router.post('/requests/:id/allocate', allocateRequest);
router.post('/transfusion', recordTransfusion);
router.get('/transfusion-logs', getTransfusionLogs);
router.post('/units/:id/dispose', disposeUnit);
router.get('/disposal-logs', getDisposalLogs);

export default router;
