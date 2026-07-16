import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRouter from './routes/auth.js';
import meRouter from './routes/me.js';
import adminRouter from './routes/admin.js';
import webhooksRouter from './routes/webhooks.js';
import trackingRouter from './routes/tracking.js';
import { errorHandler } from './middleware/errors.js';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/webhooks', webhooksRouter);

  // Referral redirect (/r/:code) + demo storefront (/store) live at the root
  app.use('/', trackingRouter);

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);

  return app;
}
