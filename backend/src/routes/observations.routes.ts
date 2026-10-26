import { Router, type Request } from 'express';
import { ApiError } from '../middleware/error.middleware.js';
import {
  getObservation,
  listAssignments,
  signObservation,
  submitSignedForm,
  type FormAnswer,
} from '../services/observation.service.js';

// Mounted at /api/me/assignments
export const myAssignmentsRouter = Router();
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
  res.status(200).json(await signObservation(observationId(req), req.user!));
});
