import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { ZodError } from 'zod';
import { Prisma, prisma } from '@token-factory/database';
import { config, corsOrigins } from './config.js';
import { authRouter } from './routes/auth.js';
import { accountRouter } from './routes/account.js';
import { adminRouter } from './routes/admin.js';
import { v1Router } from './routes/v1.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: (origin, callback) => callback(null, !origin || corsOrigins.includes(origin)), credentials: true, exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'] }));
app.use(express.json({ limit: '2mb' }));
app.use(pinoHttp({ logger }));
app.use((req, res, next) => {
  req.requestId = (typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id'].slice(0, 100)) || randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'token-factory-gateway' }));
app.get('/', (_req, res) => res.json({ name: 'Token Factory Gateway', version: '1.0.0', docs: '/v1/models', health: '/health' }));
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api', accountRouter);
app.use('/v1', v1Router);

app.use((_req, res) => res.status(404).json({ error: { message: 'Route not found', type: 'not_found_error' } }));

const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  req.log?.error({ err: error, requestId: req.requestId }, 'request failed');
  if (error instanceof ZodError) return res.status(400).json({ error: { message: 'Request validation failed', type: 'invalid_request_error', details: error.flatten() } });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: { message: 'A record with this value already exists', type: 'conflict_error' } });
  const message = error instanceof Error ? error.message : 'Internal server error';
  const clientError = /not found|not available|invalid|blocked|quota|balance|unavailable/i.test(message);
  res.status(clientError ? 400 : 500).json({ error: { message: config.NODE_ENV === 'production' && !clientError ? 'Internal server error' : message, type: clientError ? 'invalid_request_error' : 'server_error' } });
};
app.use(errorHandler);

const server = app.listen(config.PORT, '0.0.0.0', () => logger.info({ port: config.PORT }, 'token-factory-gateway listening'));

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
