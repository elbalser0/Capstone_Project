import { Router } from 'express';
import { listMyNotifications } from '../services/notification.service.js';

// Mounted at /api/me/notifications
export const myNotificationsRouter = Router();

myNotificationsRouter.get('/', async (req, res) => {
  res.status(200).json(await listMyNotifications(req.user!.netid));
});
