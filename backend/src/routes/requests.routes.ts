import { Router, type Request } from 'express';
import { ApiError } from '../middleware/error.middleware.js';
import { listOutgoingRequests } from '../services/request.service.js';
import { isIsoDate } from '../services/cycle.service.js';
import { confirmRequest, declineRequest, listIncomingRequests } from '../services/request.service.js';

// Mounted at /api/me/requests
export const myRequestsRouter = Router();
// Mounted at /api/signups/:signupId/requests
export const signupRequestsRouter = Router({ mergeParams: true });

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

// Requests sent for my own sign-up, so I can see who has answered.
myRequestsRouter.get('/outgoing', async (req, res) => {
  res.status(200).json(await listOutgoingRequests(req.user!.netid));
});
