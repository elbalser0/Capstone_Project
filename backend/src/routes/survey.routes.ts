import { Router, type Request } from 'express';
import { requireAC } from '../middleware/auth.middleware.js';
import { ApiError } from '../middleware/error.middleware.js';
import { readMultipart } from './multipart.js';
import { getTroubleFile, listSurveyResponses, submitSurvey, type SurveyInput, type TroubleFile } from '../services/survey.service.js';

// Mounted at /api/cycles/:cycleId/survey-responses (after requireLogin)
export const surveyRouter = Router({ mergeParams: true });

const TEXT_LIMIT = 5000;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
// The file plus the text fields and form overhead.
export const MAX_FORM_BYTES = MAX_FILE_BYTES + 64 * 1024;
const FILE_NAME_LIMIT = 255;

function cycleId(req: Request) {
  const id = String(req.params.cycleId);
  if (!/^[1-9]\d{0,8}$/.test(id)) throw new ApiError(400, 'INVALID_CYCLE_ID', 'cycleId must be a positive integer.');
  return Number(id);
}

const invalid = (message: string) => new ApiError(400, 'INVALID_SURVEY', message);

// The frontend sends multipart form data (all values are strings); JSON is accepted too.
export function readSurvey(fields: Record<string, unknown>): SurveyInput {
  const role = fields.respondentRole;
  if (role !== 'observer' && role !== 'observee') throw invalid('respondentRole must be observer or observee.');
  const ok = fields.processOk;
  if (ok !== true && ok !== false && ok !== 'true' && ok !== 'false') throw invalid('processOk must be true or false.');
  const text = (name: string) => {
    const value = fields[name];
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw invalid(`${name} must be text.`);
    if (value.length > TEXT_LIMIT) throw invalid(`${name} must be ${TEXT_LIMIT} characters or fewer.`);
    return value.trim() || null;
  };
  return { respondentRole: role, processOk: ok === true || ok === 'true', difficulties: text('difficulties'), additionalFeedback: text('additionalFeedback') };
}

async function readBody(req: Request): Promise<{ fields: Record<string, unknown>; file?: TroubleFile }> {
  if (!req.is('multipart/form-data')) {
    if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) {
      throw invalid('Send the survey as form data or a JSON object.');
    }
    return { fields: req.body as Record<string, unknown> };
  }
  const form = await readMultipart(req, MAX_FORM_BYTES,
    () => new ApiError(413, 'TOO_LARGE', 'The survey is too large.'),
    () => invalid('The form data could not be read.'));
  const fields = Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === 'string'));
  const upload = form.get('troubleFile');
  if (!(upload instanceof Blob) || upload.size === 0) return { fields };
  if (upload.size > MAX_FILE_BYTES) throw new ApiError(400, 'FILE_TOO_LARGE', 'Files can be up to 10 MB.');
  const name = ((upload as File).name ?? '').trim() || 'attachment';
  return {
    fields,
    file: {
      name: name.slice(0, FILE_NAME_LIMIT),
      type: upload.type || 'application/octet-stream',
      data: Buffer.from(await upload.arrayBuffer()),
    },
  };
}

surveyRouter.post('/', async (req, res) => {
  const id = cycleId(req);
  const { fields, file } = await readBody(req);
  res.status(201).json(await submitSurvey(id, req.user!.netid, readSurvey(fields), file));
});

surveyRouter.get('/', requireAC, async (req, res) => {
  res.status(200).json(await listSurveyResponses(cycleId(req)));
});

function responseId(value: unknown) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,8}$/.test(value)) {
    throw new ApiError(400, 'INVALID_RESPONSE_ID', 'responseId must be a positive integer.');
  }
  return Number(value);
}

surveyRouter.get('/:responseId/trouble-file', requireAC, async (req, res) => {
  const file = await getTroubleFile(cycleId(req), responseId(req.params.responseId));
  res.status(200)
    .type(file.file_type)
    .set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`)
    .set('X-Content-Type-Options', 'nosniff')
    .send(file.file_data);
});
