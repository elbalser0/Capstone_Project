import express from 'express';
import { cyclesRouter } from './routes/cycles.routes.js';
import { healthRouter } from './routes/health.routes.js';
import { facultyMeRouter, signupsRouter } from './routes/faculty-scaffold.routes.js';
import { errorHandler } from './middleware/error.middleware.js';
import { myNotificationsRouter } from './routes/notifications.routes.js';
import { requireLogin } from './middleware/auth.middleware.js';
import { meRouter } from './routes/me.routes.js';

export const app = express();
app.use('/api/me/notifications', requireLogin, myNotificationsRouter);
app.disable('x-powered-by');
app.use(express.json());
app.use('/api/cycles', requireLogin, cyclesRouter);
app.use('/api/health', healthRouter);
app.use('/api/me', requireLogin, meRouter, facultyMeRouter);
app.use('/api/signups', requireLogin, signupsRouter);
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested endpoint does not exist.' } });
});
app.use(errorHandler);
