import { Router } from 'express';

export const meRouter = Router();

// GET /api/me -> who is logged in and which roles they have.
meRouter.get('/', (req, res) => {
  res.status(200).json(req.user);
});