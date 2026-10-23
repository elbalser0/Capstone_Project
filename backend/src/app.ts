import express from 'express';
import { healthRouter } from './routes/health.routes.js';
import { facultyMeRouter, signupsRouter } from './routes/faculty-scaffold.routes.js';
import { errorHandler } from './middleware/error.middleware.js';
import { requireLogin } from './middleware/auth.middleware.js';
import { myAssignmentsRouter, observationsRouter } from './routes/observations.routes.js';
import { meRouter } from './routes/me.routes.js';

export const app = express();
app.disable('x-powered-by');
app.use('/api/me/assignments', requireLogin, myAssignmentsRouter);
app.use(express.json());
app.use('/api/health', healthRouter);
app.use('/api/me', requireLogin, meRouter, facultyMeRouter);
app.use('/api/signups', requireLogin, signupsRouter);
app.use('/api/observations', requireLogin, observationsRouter);
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested endpoint does not exist.' } });
});
app.use(errorHandler);
