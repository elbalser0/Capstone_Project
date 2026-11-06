import { Router } from 'express';
import { listAdminProfessors } from '../services/admin-professor.service.js';
import { listDepartments } from '../services/department.service.js';

// Mounted at /api/admin (after authenticate and requireAdmin)
export const adminRouter = Router();

adminRouter.get('/professors', async (_req, res) => {
  res.status(200).json(await listAdminProfessors());
});

adminRouter.get('/departments', async (_req, res) => {
  res.status(200).json(await listDepartments());
});
