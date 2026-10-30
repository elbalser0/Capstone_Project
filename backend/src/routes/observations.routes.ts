import { Router, type Request } from 'express';
import { ApiError } from '../middleware/error.middleware.js';
import {
  getObservation,
  listAssignments,
  listReceivedObservations,
  reportMissed,
  signObservation,
  submitSignedForm,
  type FormAnswer,
} from '../services/observation.service.js';

// Mounted at /api/me/assignments
export const myAssignmentsRouter = Router();
// Mounted at /api/me/observations
export const myObservationsRouter = Router();
// Mounted at /api/observations
export const observationsRouter = Router();

function observationId(req: Request): number {
  const id = String(req.params.observationId);
  if (!/^[1-9]\d{0,8}$/.test(id)) {
    throw new ApiError(400, 'INVALID_OBSERVATION_ID', 'observationId must be a positive integer.');
  }
  return Number(id);
}

// Checks the body of POST .../signed-form.
export function readSignedForm(body: unknown): { answers: FormAnswer[]; otherComments: string } {
  const input = typeof body === 'object' && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const answers = input.answers;
  const otherComments = input.otherComments ?? '';
  const valid = Array.isArray(answers) && typeof otherComments === 'string' && answers.every((answer) =>
    typeof answer === 'object' && answer !== null &&
    typeof answer.questionId === 'string' && typeof answer.rating === 'number' &&
    (answer.comment === undefined || typeof answer.comment === 'string'));
  if (!valid) {
    throw new ApiError(400, 'INVALID_FORM', 'Send answers as [{ questionId, rating, comment }] and otherComments as text.');
  }
  return {
    answers: (answers as FormAnswer[]).map((answer) => ({
      questionId: answer.questionId, rating: answer.rating, comment: (answer.comment ?? '').trim(),
    })),
    otherComments: (otherComments as string).trim(),
  };
}

// Checks the body of POST .../sign: the lastSavedDate from GET /api/observations/{observationId}.
export function readSignBody(body: unknown): string {
  const input = typeof body === 'object' && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const lastSavedDate = input.lastSavedDate;
  if (typeof lastSavedDate !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(lastSavedDate) || Number.isNaN(Date.parse(lastSavedDate))) {
    throw new ApiError(400, 'INVALID_SIGN', 'Send the lastSavedDate of the form you are signing.');
  }
  return lastSavedDate;
}

// Checks the body of POST .../report-missed: a non-empty reason.
export function readReportMissed(body: unknown): string {
  const input = typeof body === 'object' && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason) throw new ApiError(400, 'REASON_REQUIRED', 'Say why the observation did not happen.');
  return reason;
}

// GET /api/me/observations only lists observations as the observee; the observer's list is /api/me/assignments.
myObservationsRouter.get('/', async (req, res) => {
  if (req.query.as !== 'observee') {
    throw new ApiError(400, 'INVALID_AS', 'Use as=observee. Observations you observe are at /api/me/assignments.');
  }
  res.status(200).json(await listReceivedObservations(req.user!.netid));
});

myAssignmentsRouter.get('/', async (req, res) => {
  res.status(200).json(await listAssignments(req.user!.netid));
});

observationsRouter.get('/:observationId', async (req, res) => {
  res.status(200).json(await getObservation(observationId(req), req.user!));
});

observationsRouter.post('/:observationId/signed-form', async (req, res) => {
  const id = observationId(req);
  const { answers, otherComments } = readSignedForm(req.body);
  res.status(200).json(await submitSignedForm(id, req.user!, answers, otherComments));
});

observationsRouter.post('/:observationId/sign', async (req, res) => {
  const id = observationId(req);
  res.status(200).json(await signObservation(id, req.user!, readSignBody(req.body)));
});

observationsRouter.post('/:observationId/report-missed', async (req, res) => {
  const id = observationId(req);
  res.status(200).json(await reportMissed(id, req.user!, readReportMissed(req.body)));
});
