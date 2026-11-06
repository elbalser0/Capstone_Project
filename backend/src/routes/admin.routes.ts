import { Router } from 'express';

// Mounted at /api/admin (after authenticate and requireAdmin)
export const adminRouter = Router();
