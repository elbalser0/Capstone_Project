import { Router } from 'express';
import { ApiError } from '../middleware/error.middleware.js';
import {
  createProfessor,
  listAdminProfessors,
  updateProfessor,
  type NewProfessor,
  type ProfessorChanges,
} from '../services/admin-professor.service.js';
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

const CHANGE_FIELDS = ['rank', 'isAc', 'isActive'];

// Body of PATCH /api/admin/professors/:netid. Throws 400 INVALID_PROFESSOR naming the bad field.
export function parseProfessorChanges(body: unknown): ProfessorChanges {
  const fields = bodyObject(body, 'INVALID_PROFESSOR', 'changes');
  const invalid = (message: string) => new ApiError(400, 'INVALID_PROFESSOR', message);
  const unknown = Object.keys(fields).find((key) => !CHANGE_FIELDS.includes(key));
  if (unknown !== undefined) throw invalid(`${unknown} cannot be changed here; send only rank, isAc or isActive.`);
  if (Object.keys(fields).length === 0) throw invalid('Send at least one of rank, isAc or isActive.');

  const changes: ProfessorChanges = {};
  if ('rank' in fields) {
    if (!isRank(fields.rank)) throw invalid('rank must be assistant, associate or full.');
    changes.rank = fields.rank;
  }
  for (const flag of ['isAc', 'isActive'] as const) {
    if (!(flag in fields)) continue;
    if (typeof fields[flag] !== 'boolean') throw invalid(`${flag} must be true or false.`);
    changes[flag] = fields[flag];
  }
  return changes;
}

adminRouter.get('/professors', async (_req, res) => {
  res.status(200).json(await listAdminProfessors());
});

adminRouter.post('/professors', async (req, res) => {
  res.status(201).json(await createProfessor(parseNewProfessor(req.body)));
});

adminRouter.patch('/professors/:netid', async (req, res) => {
  const changes = parseProfessorChanges(req.body);
  res.status(200).json(await updateProfessor(req.params.netid.trim().toLowerCase(), changes));
});

adminRouter.get('/departments', async (_req, res) => {
  res.status(200).json(await listDepartments());
});

adminRouter.post('/terms', async (req, res) => {
  res.status(201).json(await createTerm(parseNewTerm(req.body)));
});
