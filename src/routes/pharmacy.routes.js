/**
 * Pharmacy routes: /api/pharmacy/*. Auth + Pharmacy role required.
 */
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import {
  getDashboard,
  getMedicines,
  createMedicine,
  updateMedicine,
  deleteMedicine,
  getPendingPrescriptions,
  dispensePrescription,
  rejectPrescription,
  getDispensingLogs,
  getExpiryList,
  getPurchaseOrders,
  createPurchaseOrder,
  updatePurchaseOrder,
} from '../controllers/pharmacy.controller.js';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('Pharmacy', 'Admin'));

router.get('/dashboard', getDashboard);
router.get('/medicines', getMedicines);
router.post('/medicines', createMedicine);
router.patch('/medicines/:id', updateMedicine);
router.delete('/medicines/:id', deleteMedicine);
router.get('/prescriptions/pending', getPendingPrescriptions);
router.post('/prescriptions/:id/dispense', dispensePrescription);
router.post('/prescriptions/:id/reject', rejectPrescription);
router.get('/dispensing-logs', getDispensingLogs);
router.get('/expiry', getExpiryList);
router.get('/purchase-orders', getPurchaseOrders);
router.post('/purchase-orders', createPurchaseOrder);
router.patch('/purchase-orders/:id', updatePurchaseOrder);

export default router;
