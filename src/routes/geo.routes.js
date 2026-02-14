/**
 * Geo routes: geocoding and routing. Authenticated users only.
 */
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { geocode, calculateRoute } from '../controllers/geo.controller.js';

const router = Router();
router.use(authMiddleware);

router.post('/geocode', geocode);
router.post('/routing/calculate', calculateRoute);

export default router;
