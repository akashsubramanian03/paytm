/**
 * Nambikai's HTTP surface, mounted at /api/v1/nambikai.
 *
 * Kept as a single mount point so app.js gains exactly one line and the wallet's
 * existing routes are untouched.
 */
import { Router } from 'express';
import { requestId } from '../middleware/requestId.js';
import assistantRoutes from './nambikai/assistant.routes.js';
import businessRoutes from './nambikai/business.routes.js';
import clusterRoutes from './nambikai/cluster.routes.js';
import consentRoutes from './nambikai/consent.routes.js';
import groupRoutes from './nambikai/groups.routes.js';
import scoreRoutes from './nambikai/score.routes.js';
import underwritingRoutes from './nambikai/underwriting.routes.js';

const router = Router();

// Every audit row written while serving a request shares this id, so "show me
// everything that produced this artifact" is one query.
router.use(requestId);

router.use('/assistant', assistantRoutes);
router.use('/businesses', businessRoutes);
router.use('/cluster', clusterRoutes);
router.use('/consents', consentRoutes);
router.use('/groups', groupRoutes);
router.use('/score', scoreRoutes);
router.use('/underwriting', underwritingRoutes);

export default router;
