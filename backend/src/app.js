import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import config from './config.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import accountRoutes from './routes/account.routes.js';
import transactionRoutes from './routes/transaction.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import nambikaiRoutes from './routes/nambikai.routes.js';
import { setClusterProvider } from './nambikai/pipeline/underwrite.pipeline.js';
import { clusterSignalForUser } from './nambikai/pipeline/cluster.pipeline.js';

// The cluster signal is wired in at composition time rather than imported
// directly by the underwriting pipeline. That keeps the dependency pointing one
// way — underwriting knows there MIGHT be a cluster provider, and never reaches
// into cluster internals — and it means the null path stays exercisable.
setClusterProvider(({ userId, asOf }) => clusterSignalForUser(userId, { asOf }));

export function createApp() {
  const app = express();

  // Only ever runs behind localhost in this project.
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin requests and tools like curl send no Origin header.
        if (!origin) return callback(null, true);
        if (config.cors.origins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed by CORS_ORIGIN.`));
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: '100kb' }));
  if (config.isDev) app.use(morgan('dev'));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'paytm-api', env: config.env, time: new Date().toISOString() });
  });

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/users', userRoutes);
  app.use('/api/v1/account', accountRoutes);
  app.use('/api/v1/transactions', transactionRoutes);
  app.use('/api/v1/payments', paymentRoutes);
  app.use('/api/v1/nambikai', nambikaiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
