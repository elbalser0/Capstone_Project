import { Router } from 'express';
import { requireAC } from '../middleware/auth.middleware.js';
import { ApiError } from '../middleware/error.middleware.js';
import {
  createCycle,
  getCurrentCycle,
  isIsoDate,
  updateCycle,
  type Deadlines,
} from '../services/cycle.service.js';
import { listCycleSignups } from '../services/cycle-signups.service.js';
import { listMatching, runMatching } from '../services/matching.service.js';
import { sendDueReminders, sendListsReady, sendSurveyOpen } from '../services/notification.service.js';
import { getCycleKpis } from '../services/kpi.service.js';

// Mounted at /api/cycles (after requireLogin)
export const cyclesRouter = Router();

const deadlineFields = ['signupDeadline', 'observationDeadline', 'feedbackDeadline'] as const;

function bodyObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_CYCLE', 'Send the deadlines as a JSON object.');
  }
  return body as Record<string, unknown>;
}

function positiveId(value: unknown, code: string, name: string): number {
  if (typeof value !== 'string' || !/^[1-9]\d{0,8}$/.test(value)) {
    throw new ApiError(400, code, `${name} must be a positive integer.`);
  }
  return Number(value);
}

cyclesRouter.get('/current', async (_req, res) => {
  res.status(200).json(await getCurrentCycle());
});

cyclesRouter.get('/:cycleId/signups', requireAC, async (req, res) => {
  const cycleId = positiveId(req.params.cycleId, 'INVALID_CYCLE_ID', 'cycleId');
  res.status(200).json(await listCycleSignups(cycleId));
});

cyclesRouter.get('/:cycleId/kpis', requireAC, async (req, res) => {
  const cycleId = req.params.cycleId === 'latest'
    ? 'latest'
    : positiveId(req.params.cycleId, 'INVALID_CYCLE_ID', 'cycleId');
  res.status(200).json(await getCycleKpis(cycleId));
});

cyclesRouter.post('/', requireAC, async (req, res) => {
  const body = bodyObject(req.body);
  const termId = positiveId(body.termId, 'INVALID_TERM_ID', 'termId');
  const deadlines: Record<string, string> = {};
  for (const field of deadlineFields) {
    if (!isIsoDate(body[field])) throw new ApiError(400, 'INVALID_CYCLE', `${field} must be a YYYY-MM-DD date.`);
    deadlines[field] = body[field];
  }
  res.status(201).json(await createCycle(req.user!.netid, termId, deadlines as unknown as Deadlines));
});

cyclesRouter.patch('/:cycleId', requireAC, async (req, res) => {
  const cycleId = positiveId(req.params.cycleId, 'INVALID_CYCLE_ID', 'cycleId');
  const body = bodyObject(req.body);
  const changes: Partial<Deadlines> = {};
  for (const field of deadlineFields) {
    if (body[field] === undefined) continue;
    if (!isIsoDate(body[field])) throw new ApiError(400, 'INVALID_CYCLE', `${field} must be a YYYY-MM-DD date.`);
    changes[field] = body[field];
  }
  if (Object.keys(changes).length === 0) {
    throw new ApiError(400, 'INVALID_CYCLE', 'Send at least one deadline to change.');
  }
  res.status(200).json(await updateCycle(cycleId, changes));
});

// Committee only: run observer selection for the cycle's sign-ups.
cyclesRouter.post('/:cycleId/matching', requireAC, async (req, res) => {
  const cycleId = positiveId(req.params.cycleId, 'INVALID_CYCLE_ID', 'cycleId');
  res.status(200).json(await runMatching(cycleId));
});

cyclesRouter.get('/:cycleId/matching', requireAC, async (req, res) => {
  const cycleId = positiveId(req.params.cycleId, 'INVALID_CYCLE_ID', 'cycleId');
  res.status(200).json(await listMatching(cycleId));
});

// Optional { netids: string[] }; no body or an empty list means everyone due.
export function readReminderNetids(body: unknown): string[] | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_NETIDS', 'Send netids as a list of professor IDs.');
  }
  const netids = (body as Record<string, unknown>).netids;
  if (netids === undefined) return undefined;
  if (!Array.isArray(netids) || !netids.every((id) => typeof id === 'string' && id.trim() !== '' && id.trim() === id)) {
    throw new ApiError(400, 'INVALID_NETIDS', 'Send netids as a list of professor IDs.');
  }
  return [...new Set(netids as string[])];
}

cyclesRouter.post('/:cycleId/notifications/due-reminders', requireAC, async (req, res) => {
  const cycleId = positiveId(req.params.cycleId, 'INVALID_CYCLE_ID', 'cycleId');
  res.status(200).json(await sendDueReminders(cycleId, req.user!.netid, readReminderNetids(req.body)));
});

cyclesRouter.post('/:cycleId/notifications/lists-ready', requireAC, async (req, res) => {
  const cycleId = positiveId(req.params.cycleId, 'INVALID_CYCLE_ID', 'cycleId');
  res.status(200).json(await sendListsReady(cycleId, req.user!.netid));
});

cyclesRouter.post('/:cycleId/notifications/survey', requireAC, async (req, res) => {
  const cycleId = positiveId(req.params.cycleId, 'INVALID_CYCLE_ID', 'cycleId');
  res.status(200).json(await sendSurveyOpen(cycleId, req.user!.netid));
});
