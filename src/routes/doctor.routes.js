/**
 * Doctor routes: /api/doctor/*. Auth + Doctor role required.
 */
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import {
  getPatients,
  getAppointments,
  updateAppointmentStatus,
  getRecords,
  createRecord,
  getPrescriptions,
  createPrescription,
  createEmergencyRequest,
  requestIcuAdmission,
  getMyIcuRequests,
  getTransferTrips,
  getIcuMonitoringForPatient,
  createBloodRequest,
} from '../controllers/doctor.controller.js';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('Doctor'));

router.get('/patients', getPatients);
router.get('/appointments', getAppointments);
router.patch('/appointments/:id', updateAppointmentStatus);
router.get('/records', getRecords);
router.post('/records', createRecord);
router.get('/prescriptions', getPrescriptions);
router.post('/prescriptions', createPrescription);
router.post('/emergency-request', createEmergencyRequest);
router.post('/icu-admission-request', requestIcuAdmission);
router.get('/icu-requests', getMyIcuRequests);
router.get('/transfer-trips', getTransferTrips);
router.get('/icu-monitoring', getIcuMonitoringForPatient);
router.post('/blood-requests', createBloodRequest);

export default router;
