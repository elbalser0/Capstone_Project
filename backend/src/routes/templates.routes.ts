import { Router } from 'express';
import { requireAC } from '../middleware/auth.middleware.js';
import { ApiError } from '../middleware/error.middleware.js';
import { createDraft, getActiveTemplate, loadTemplateVersions, publishDraft, type QuestionInput } from '../services/template.service.js';

// Mounted at /api/templates (after requireLogin)
export const templatesRouter = Router();

const NOTE_LIMIT = 1000;
const TEXT_LIMIT = 2000;
const MAX_QUESTIONS = 100;

const invalid = (message: string) => new ApiError(400, 'INVALID_TEMPLATE', message);

function bodyObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw invalid('Send the template as a JSON object.');
  return body as Record<string, unknown>;
}

function readChangeNote(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw invalid('changeNote must be text.');
  if (value.length > NOTE_LIMIT) throw invalid(`changeNote must be ${NOTE_LIMIT} characters or fewer.`);
  return value.trim();
}

// POST /api/templates body: { changeNote, questions: [{ title, wording, ratingMin, ratingMax, minLabel, maxLabel, isRequired }] }.
// Questions are saved in the order given.
export function readTemplate(body: unknown): { changeNote: string; questions: QuestionInput[] } {
  const input = bodyObject(body);
  const questions = input.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new ApiError(400, 'QUESTIONS_REQUIRED', 'A template needs at least one question.');
  }
  if (questions.length > MAX_QUESTIONS) throw invalid(`A template can have at most ${MAX_QUESTIONS} questions.`);
  return {
    changeNote: readChangeNote(input.changeNote),
    questions: questions.map((raw, index) => {
      const n = index + 1;
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw invalid(`Question ${n} must be an object.`);
      const q = raw as Record<string, unknown>;
      const text = (name: string, required: boolean) => {
        const value = q[name];
        if (value === undefined || value === null) {
          if (required) throw invalid(`Question ${n} needs a ${name}.`);
          return '';
        }
        if (typeof value !== 'string') throw invalid(`Question ${n} ${name} must be text.`);
        if (value.length > TEXT_LIMIT) throw invalid(`Question ${n} ${name} must be ${TEXT_LIMIT} characters or fewer.`);
        const trimmed = value.trim();
        if (required && !trimmed) throw invalid(`Question ${n} needs a ${name}.`);
        return trimmed;
      };
      const { ratingMin, ratingMax, isRequired } = q;
      if (!Number.isInteger(ratingMin) || !Number.isInteger(ratingMax)) {
        throw invalid(`Question ${n} ratingMin and ratingMax must be whole numbers.`);
      }
      if ((ratingMax as number) <= (ratingMin as number)) throw invalid(`Question ${n} ratingMax must be greater than ratingMin.`);
      if (Math.abs(ratingMin as number) > 100 || Math.abs(ratingMax as number) > 100) {
        throw invalid(`Question ${n} ratings must be between -100 and 100.`);
      }
      if (isRequired !== undefined && typeof isRequired !== 'boolean') throw invalid(`Question ${n} isRequired must be true or false.`);
      return {
        title: text('title', true),
        wording: text('wording', true),
        ratingMin: ratingMin as number,
        ratingMax: ratingMax as number,
        minLabel: text('minLabel', false),
        maxLabel: text('maxLabel', false),
        isRequired: isRequired ?? true,
      };
    }),
  };
}

// PATCH body: optional { changeNote }.
export function readPublish(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  return readChangeNote(bodyObject(body).changeNote) || undefined;
}

function versionId(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d{0,8}$/.test(value)) {
    throw new ApiError(400, 'INVALID_VERSION_ID', 'versionId must be a positive integer.');
  }
  return Number(value);
}

templatesRouter.get('/', requireAC, async (_req, res) => {
  res.status(200).json(await loadTemplateVersions('true', []));
});

templatesRouter.get('/active', async (_req, res) => {
  res.status(200).json(await getActiveTemplate());
});

templatesRouter.post('/', requireAC, async (req, res) => {
  const { changeNote, questions } = readTemplate(req.body);
  res.status(201).json(await createDraft(req.user!.netid, changeNote, questions));
});

templatesRouter.patch('/:versionId/publish', requireAC, async (req, res) => {
  const id = versionId(req.params.versionId);
  res.status(200).json(await publishDraft(id, readPublish(req.body)));
});
