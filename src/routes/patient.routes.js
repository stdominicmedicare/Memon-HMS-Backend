/**
 * Patient routes: /api/patient/*. Auth + Patient role required.
 */
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import {
  getDoctors,
  getAppointments,
  bookAppointment,
  getRecords,
  getPrescriptions,
  getDashboardStats,
  getAmbulanceAvailability,
  getActiveAmbulanceTrip,
  getAmbulanceRequests,
  createAmbulanceRequest,
  cancelAmbulanceRequest,
  getIcuStatus,
  getIcuMonitoringReport,
  getTransfusionHistory,
} from '../controllers/patient.controller.js';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('Patient'));

router.get('/doctors', getDoctors);
router.get('/dashboard/stats', getDashboardStats);
router.get('/appointments', getAppointments);
router.post('/appointments', bookAppointment);
router.get('/records', getRecords);
router.get('/prescriptions', getPrescriptions);
router.get('/ambulance-availability', getAmbulanceAvailability);
router.get('/ambulance-requests/active', getActiveAmbulanceTrip);
router.get('/ambulance-requests', getAmbulanceRequests);
router.post('/ambulance-requests', createAmbulanceRequest);
router.patch('/ambulance-requests/:id/cancel', cancelAmbulanceRequest);
router.get('/icu-status', getIcuStatus);
router.get('/icu-monitoring-report', getIcuMonitoringReport);
router.get('/transfusion-history', getTransfusionHistory);

export default router;
