import { Router } from 'express';
import { requireAC } from '../middleware/auth.middleware.js';
import { ApiError } from '../middleware/error.middleware.js';
import { listTerms, previewDueProfessors } from '../services/term.service.js';

// Mounted at /api/terms (after requireLogin)
export const termsRouter = Router();

termsRouter.get('/', requireAC, async (_req, res) => {
  res.status(200).json(await listTerms());
});

termsRouter.get('/:termId/due-preview', requireAC, async (req, res) => {
  const termId = req.params.termId;
  if (typeof termId !== 'string' || !/^[1-9]\d{0,8}$/.test(termId)) {
    throw new ApiError(400, 'INVALID_TERM_ID', 'termId must be a positive integer.');
  }
  res.status(200).json(await previewDueProfessors(Number(termId)));
});
