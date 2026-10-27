import { Router } from 'express';
import { ApiError } from '../middleware/error.middleware.js';
import { listSignupCandidates } from '../services/candidate.service.js';
import { listCourses } from '../services/course.service.js';
import { getEvaluationStatus } from '../services/evaluation-status.service.js';
import { createSignup, getMySignup } from '../services/signup.service.js';

export const facultyMeRouter = Router();
export const signupsRouter = Router();

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function parsePositiveId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isInteger(id) && id <= 2147483647 ? id : null;
}

facultyMeRouter.get('/evaluation-status', async (req, res) => {
  res.status(200).json(await getEvaluationStatus(req.user!.netid));
});

facultyMeRouter.get('/signup', async (req, res) => {
  res.status(200).json(await getMySignup(req.user!));
});

facultyMeRouter.get('/courses', async (req, res) => {
  const termId = parsePositiveId(req.query.termId);
  if (termId === null) {
    throw new ApiError(400, 'INVALID_TERM_ID', 'termId must be a positive integer.');
  }
  res.status(200).json(await listCourses(req.user!.netid, termId));
});

signupsRouter.post('/', async (req, res) => {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_SIGNUP', 'Provide a sectionId and at least one proposed date.');
  }
  const { sectionId, proposedDates } = body as Record<string, unknown>;
  const parsedSectionId = parsePositiveId(sectionId);
  if (parsedSectionId === null ||
      !Array.isArray(proposedDates) || proposedDates.length === 0 || !proposedDates.every(isIsoDate)) {
    throw new ApiError(400, 'INVALID_SIGNUP', 'Provide a sectionId and proposedDates as YYYY-MM-DD dates.');
  }
  res.status(201).json(await createSignup(req.user!, parsedSectionId, proposedDates));
});

signupsRouter.get('/:signupId/candidates', async (req, res) => {
  const signupId = parsePositiveId(req.params.signupId);
  if (signupId === null) {
    throw new ApiError(400, 'INVALID_SIGNUP_ID', 'signupId must be a positive integer.');
  }
  res.status(200).json(await listSignupCandidates(signupId, req.user!.netid));
});
