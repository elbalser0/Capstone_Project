import { Router } from 'express';
import { ApiError } from '../middleware/error.middleware.js';
import { createProfessor, listAdminProfessors, type NewProfessor } from '../services/admin-professor.service.js';
import { listDepartments } from '../services/department.service.js';

// Mounted at /api/admin (after authenticate and requireAdmin)
export const adminRouter = Router();

function bodyObject(body: unknown, code: string, what: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, code, `Send the ${what} as a JSON object.`);
  }
  return body as Record<string, unknown>;
}

const RANKS = ['assistant', 'associate', 'full'] as const;
const NETID = /^[a-z]{3}\d{6}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POSITIVE_ID = /^[1-9]\d{0,8}$/;

function isRank(value: unknown): value is NewProfessor['rank'] {
  return RANKS.includes(value as NewProfessor['rank']);
}

// Body of POST /api/admin/professors. Throws 400 INVALID_PROFESSOR naming the bad field.
export function parseNewProfessor(body: unknown): NewProfessor {
  const fields = bodyObject(body, 'INVALID_PROFESSOR', 'professor');
  const invalid = (message: string) => new ApiError(400, 'INVALID_PROFESSOR', message);
  const text = (name: string) => (typeof fields[name] === 'string' ? (fields[name] as string).trim() : '');

  const netid = text('netid').toLowerCase();
  if (!NETID.test(netid)) throw invalid('netid must be three letters followed by six digits, like abc123456.');
  const firstName = text('firstName');
  if (!firstName) throw invalid('firstName is required.');
  const lastName = text('lastName');
  if (!lastName) throw invalid('lastName is required.');
  const email = text('email');
  if (!EMAIL.test(email)) throw invalid('email must be a valid email address.');
  const { rank, deptId } = fields;
  if (!isRank(rank)) throw invalid('rank must be assistant, associate or full.');
  if (typeof deptId !== 'string' || !POSITIVE_ID.test(deptId)) {
    throw invalid('deptId must be a department ID such as "3".');
  }
  return { netid, firstName, lastName, email, rank, deptId: Number(deptId) };
}

adminRouter.get('/professors', async (_req, res) => {
  res.status(200).json(await listAdminProfessors());
});

adminRouter.post('/professors', async (req, res) => {
  res.status(201).json(await createProfessor(parseNewProfessor(req.body)));
});

adminRouter.get('/departments', async (_req, res) => {
  res.status(200).json(await listDepartments());
});
