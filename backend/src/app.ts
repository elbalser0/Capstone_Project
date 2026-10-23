import express from 'express';
import { healthRouter } from './routes/health.routes.js';
import { facultyMeRouter, signupsRouter } from './routes/faculty-scaffold.routes.js';
import { errorHandler } from './middleware/error.middleware.js';
import { requireLogin } from './middleware/auth.middleware.js';
import { meRouter } from './routes/me.routes.js';
import { myRequestsRouter, signupRequestsRouter } from './routes/requests.routes.js';

export const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use('/api/health', healthRouter);
app.use('/api/me/requests', requireLogin, myRequestsRouter);
app.use('/api/signups/:signupId/requests', requireLogin, signupRequestsRouter);
app.use('/api/me', requireLogin, meRouter, facultyMeRouter);
app.use('/api/signups', requireLogin, signupsRouter);
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested endpoint does not exist.' } });
});
app.use(errorHandler);
