import { Router, type Request } from 'express';
import { ApiError } from '../middleware/error.middleware.js';
import { listOutgoingRequests } from '../services/request.service.js';
import { isIsoDate } from '../services/cycle.service.js';
import { confirmRequest, declineRequest, listIncomingRequests, sendRequests } from '../services/request.service.js';

// Mounted at /api/me/requests
export const myRequestsRouter = Router();
// Mounted at /api/signups/:signupId/requests
export const signupRequestsRouter = Router({ mergeParams: true });

function signupId(req: Request) {
  const signupId = String(req.params.signupId);
  if (!/^[1-9]\d{0,8}$/.test(signupId)) {
    throw new ApiError(400, 'INVALID_SIGNUP_ID', 'signupId must be a positive integer.');
  }
  return Number(signupId);
}

// Checks the URL and that the logged-in professor is the observer the request was sent to.
function requestTarget(req: Request) {
  const id = signupId(req);
  if (req.params.observerNetId !== req.user!.netid) {
    throw new ApiError(403, 'FORBIDDEN', 'You can only answer requests sent to you.');
  }
  return { signupId: id, observerNetid: req.user!.netid };
}

export function readSendRequests(body: unknown): string[] | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_OBSERVERS', 'Provide observerNetids as a list of observer IDs.');
  }
  const ids = (body as Record<string, unknown>).observerNetids;
  if (ids === undefined) return undefined;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && id.length > 0 && id.trim() === id)) {
    throw new ApiError(400, 'INVALID_OBSERVERS', 'Provide observerNetids as a list of observer IDs.');
  }
  return [...new Set(ids)];
}

myRequestsRouter.get('/incoming', async (req, res) => {
  res.status(200).json(await listIncomingRequests(req.user!.netid));
});

signupRequestsRouter.post('/', async (req, res) => {
  res.status(201).json(await sendRequests(signupId(req), req.user!.netid, readSendRequests(req.body)));
});

signupRequestsRouter.patch('/:observerNetId/confirm', async (req, res) => {
  const { signupId, observerNetid } = requestTarget(req);
  const body: unknown = req.body;
  const date = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).date : undefined;
  if (!isIsoDate(date)) {
    throw new ApiError(400, 'INVALID_DATE', 'Provide date as one of the proposed YYYY-MM-DD dates.');
  }
  res.status(200).json(await confirmRequest(signupId, observerNetid, date));
});

signupRequestsRouter.patch('/:observerNetId/decline', async (req, res) => {
  const { signupId, observerNetid } = requestTarget(req);
  res.status(200).json(await declineRequest(signupId, observerNetid));
});

// Requests sent for my own sign-up, so I can see who has answered.
myRequestsRouter.get('/outgoing', async (req, res) => {
  res.status(200).json(await listOutgoingRequests(req.user!.netid));
});
