import express from 'express';
import { healthRouter } from './routes/health.routes.js';
import { errorHandler } from './middleware/error.middleware.js';

export const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use('/api/health', healthRouter);
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested endpoint does not exist.' } });
});
app.use(errorHandler);
