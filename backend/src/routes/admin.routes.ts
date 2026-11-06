import { Router } from 'express';
import { ApiError } from '../middleware/error.middleware.js';
import { listAdminProfessors } from '../services/admin-professor.service.js';
import { isIsoDate } from '../services/cycle.service.js';
import { listDepartments } from '../services/department.service.js';
import { createTerm, type NewTerm } from '../services/term.service.js';

// Mounted at /api/admin (after authenticate and requireAdmin)
export const adminRouter = Router();

function bodyObject(body: unknown, code: string, what: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, code, `Send the ${what} as a JSON object.`);
  }
  return body as Record<string, unknown>;
}

// Body of POST /api/admin/terms. Throws 400 INVALID_TERM naming the bad field.
export function parseNewTerm(body: unknown): NewTerm {
  const { season, year, startDate, endDate } = bodyObject(body, 'INVALID_TERM', 'term');
  const invalid = (message: string) => new ApiError(400, 'INVALID_TERM', message);
  if (season !== 'fall' && season !== 'spring') throw invalid('season must be fall or spring.');
  if (typeof year !== 'number' || !Number.isInteger(year) || year < 2000 || year > 2100) {
    throw invalid('year must be a whole number from 2000 to 2100.');
  }
  if (!isIsoDate(startDate)) throw invalid('startDate must be a YYYY-MM-DD date.');
  if (!isIsoDate(endDate)) throw invalid('endDate must be a YYYY-MM-DD date.');
  if (endDate < startDate) throw invalid('endDate cannot be before startDate.');
  if (Number(startDate.slice(0, 4)) !== year) throw invalid(`startDate must be in ${year}, the term's year.`);
  return { season, year, startDate, endDate };
}

adminRouter.get('/professors', async (_req, res) => {
  res.status(200).json(await listAdminProfessors());
});

adminRouter.get('/departments', async (_req, res) => {
  res.status(200).json(await listDepartments());
});

adminRouter.post('/terms', async (req, res) => {
  res.status(201).json(await createTerm(parseNewTerm(req.body)));
});
