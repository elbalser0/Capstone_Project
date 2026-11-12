import { Router } from 'express';
import { requireAC } from '../middleware/auth.middleware.js';
import { listTerms } from '../services/term.service.js';

// Mounted at /api/terms (after requireLogin)
export const termsRouter = Router();

termsRouter.get('/', requireAC, async (_req, res) => {
  res.status(200).json(await listTerms());
});
