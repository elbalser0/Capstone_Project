import { Router } from 'express';
import { ApiError } from '../middleware/error.middleware.js';
import { listCourses } from '../services/course.service.js';
import { getEvaluationStatus } from '../services/evaluation-status.service.js';

export const facultyMeRouter = Router();
export const signupsRouter = Router();

function pending(): never {
  // shortcut: sign-up writes need their own database service and tests.
  throw new ApiError(501, 'NOT_IMPLEMENTED', 'This endpoint is awaiting application logic.');
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

facultyMeRouter.get('/evaluation-status', async (req, res) => {
  res.status(200).json(await getEvaluationStatus(req.user!.netid));
});

facultyMeRouter.get('/courses', async (req, res) => {
  if (typeof req.query.termId !== 'string' || !/^[1-9]\d*$/.test(req.query.termId)) {
    throw new ApiError(400, 'INVALID_TERM_ID', 'termId must be a positive integer.');
  }
  const termId = Number(req.query.termId);
  if (!Number.isSafeInteger(termId)) {
    throw new ApiError(400, 'INVALID_TERM_ID', 'termId must be a positive integer.');
  }
  res.status(200).json(await listCourses(req.user!.netid, termId));
});

signupsRouter.post('/', (req) => {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_SIGNUP', 'Provide a sectionId and at least one proposed date.');
  }
  const { sectionId, proposedDates } = body as Record<string, unknown>;
  if (typeof sectionId !== 'string' || !sectionId.trim() ||
      !Array.isArray(proposedDates) || proposedDates.length === 0 || !proposedDates.every(isIsoDate)) {
    throw new ApiError(400, 'INVALID_SIGNUP', 'Provide a sectionId and proposedDates as YYYY-MM-DD dates.');
  }
  pending();
});
