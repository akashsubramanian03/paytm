/**
 * Nambikai's HTTP surface, mounted at /api/v1/nambikai.
 *
 * Kept as a single mount point so app.js gains exactly one line and the wallet's
 * existing routes are untouched.
 */
import { Router } from 'express';
import groupRoutes from './nambikai/groups.routes.js';

const router = Router();

router.use('/groups', groupRoutes);

export default router;
