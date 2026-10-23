import { Router, type Request } from 'express';
import { ApiError } from '../middleware/error.middleware.js';
import { confirmRequest, declineRequest, listIncomingRequests } from '../services/request.service.js';

// Mounted at /api/me/requests
export const myRequestsRouter = Router();
// Mounted at /api/signups/:signupId/requests
export const signupRequestsRouter = Router({ mergeParams: true });

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

// Checks the URL and that the logged-in professor is the observer the request was sent to.
function requestTarget(req: Request) {
  const signupId = String(req.params.signupId);
  if (!/^[1-9]\d{0,8}$/.test(signupId)) {
    throw new ApiError(400, 'INVALID_SIGNUP_ID', 'signupId must be a positive integer.');
  }
  if (req.params.observerNetId !== req.user!.netid) {
    throw new ApiError(403, 'FORBIDDEN', 'You can only answer requests sent to you.');
  }
  return { signupId: Number(signupId), observerNetid: req.user!.netid };
}

myRequestsRouter.get('/incoming', async (req, res) => {
  res.status(200).json(await listIncomingRequests(req.user!.netid));
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
