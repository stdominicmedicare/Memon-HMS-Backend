/**
 * Admin routes: /api/admin/users, /api/admin/roles. Auth + Admin role required.
 */
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  resetPassword,
  getRoles,
  getDoctors,
  getDoctor,
  createDoctor,
  updateDoctor,
  deleteDoctor,
  getDoctorStatistics,
  getDashboardStats,
  getVolunteers,
  createVolunteer,
  updateVolunteer,
} from '../controllers/admin.controller.js';
import {
  getAmbulances,
  createAmbulance,
  updateAmbulance,
  deleteAmbulance,
  getAmbulanceRequests,
  assignAmbulanceRequest,
  getAmbulanceDrivers,
  getFleetStatus,
} from '../controllers/admin.ambulance.controller.js';
import {
  getIcuBeds,
  createIcuBed,
  updateIcuBed,
  deleteIcuBed,
  getIcuAnalytics,
} from '../controllers/admin.icu.controller.js';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('Admin'));

router.get('/dashboard', getDashboardStats);
router.get('/users', getUsers);
router.get('/users/:id', getUser);
router.post('/users', createUser);
router.patch('/users/:id/reset-password', resetPassword);
router.patch('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
router.get('/roles', getRoles);

router.get('/doctors', getDoctors);
router.get('/doctors/:id', getDoctor);
router.post('/doctors', createDoctor);
router.patch('/doctors/:id', updateDoctor);
router.delete('/doctors/:id', deleteDoctor);
router.get('/doctors/:id/statistics', getDoctorStatistics);

router.get('/ambulances', getAmbulances);
router.post('/ambulances', createAmbulance);
router.patch('/ambulances/:id', updateAmbulance);
router.delete('/ambulances/:id', deleteAmbulance);
router.get('/ambulance-requests', getAmbulanceRequests);
router.patch('/ambulance-requests/:id/assign', assignAmbulanceRequest);
router.get('/ambulance-drivers', getAmbulanceDrivers);
router.get('/fleet-status', getFleetStatus);

router.get('/icu-beds', getIcuBeds);
router.post('/icu-beds', createIcuBed);
router.patch('/icu-beds/:id', updateIcuBed);
router.delete('/icu-beds/:id', deleteIcuBed);
router.get('/icu-analytics', getIcuAnalytics);

router.get('/volunteers', getVolunteers);
router.post('/volunteers', createVolunteer);
router.patch('/volunteers/:id', updateVolunteer);

export default router;
