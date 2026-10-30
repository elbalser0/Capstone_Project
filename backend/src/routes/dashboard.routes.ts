import { Router } from 'express';
import { requireAC } from '../middleware/auth.middleware.js';
import { listDueByRank } from '../services/due-by-rank.service.js';
import { listUnmatchedFaculty } from '../services/unmatched.service.js';

// Mounted at /api/dashboard (after requireLogin)
export const dashboardRouter = Router();

dashboardRouter.get('/due-by-rank', requireAC, async (_req, res) => {
  res.status(200).json(await listDueByRank());
});

dashboardRouter.get('/unmatched', requireAC, async (_req, res) => {
  res.status(200).json(await listUnmatchedFaculty());
});
