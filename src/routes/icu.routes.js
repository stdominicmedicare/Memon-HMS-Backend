/**
 * ICU routes: /api/icu/*. Auth + ICU role required.
 */
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import {
  getDashboard,
  updateBedStatus,
  getAdmissionRequests,
  approveRequest,
  rejectRequest,
  assignBed,
  getActivePatients,
  getMonitoringLogs,
  addMonitoringLog,
  dischargePatient,
  transferBed,
  requestAmbulanceTransfer,
  getHistory,
  createBloodRequest,
} from '../controllers/icu.controller.js';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('ICU'));

router.get('/dashboard', getDashboard);
router.patch('/beds/:id/status', updateBedStatus);
router.get('/admission-requests', getAdmissionRequests);
router.post('/admission-requests/:id/approve', approveRequest);
router.post('/admission-requests/:id/reject', rejectRequest);
router.patch('/admission-requests/:id/assign-bed', assignBed);
router.get('/active-patients', getActivePatients);
router.get('/monitoring', getMonitoringLogs);
router.post('/monitoring', addMonitoringLog);
router.patch('/admission-records/:id/discharge', dischargePatient);
router.patch('/admission-records/:id/transfer-bed', transferBed);
router.post('/request-ambulance-transfer', requestAmbulanceTransfer);
router.get('/history', getHistory);
router.post('/blood-requests', createBloodRequest);

export default router;
