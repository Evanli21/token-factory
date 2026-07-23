import type { NextFunction, Request, Response } from 'express';
import { prisma } from '@szrouter/database';
import { config } from '../config.js';
import { apiKeyHash, verifyToken } from '../lib/security.js';
import { hitRateLimit } from '../lib/redis.js';

function bearer(req: Request) {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
}

function cookie(req: Request, name: string) {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const item of header.split(';')) {
    const [key, ...value] = item.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

export async function userAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = bearer(req) || cookie(req, 'szrouter_session');
    if (!token) return res.status(401).json({ error: { message: 'Missing bearer token', type: 'authentication_error' } });
    const payload = verifyToken(token);
    if (payload.type !== 'user' || !payload.sub) throw new Error('Invalid token');
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'ACTIVE') throw new Error('User is unavailable');
    req.auth = { user };
    next();
  } catch {
    return res.status(401).json({ error: { message: 'Invalid or expired token', type: 'authentication_error' } });
  }
}

export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = bearer(req) || (typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : undefined);
    if (!token || (!token.startsWith('sz_') && !token.startsWith('tf_'))) throw new Error('API key required');
    const apiKey = await prisma.apiKey.findUnique({
      where: { keyHash: apiKeyHash(token) },
      include: { user: true },
    });
    if (!apiKey || apiKey.status !== 'ACTIVE' || apiKey.user.status !== 'ACTIVE') throw new Error('Invalid API key');
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) throw new Error('Expired API key');

    const rate = await hitRateLimit(apiKey.id, apiKey.rateLimit || config.RATE_LIMIT_PER_MINUTE);
    res.setHeader('X-RateLimit-Limit', rate.limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, rate.limit - rate.count));
    if (!rate.allowed) return res.status(429).json({ error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } });

    req.auth = { user: apiKey.user, apiKey, organizationId: apiKey.organizationId || undefined };
    void prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });
    next();
  } catch {
    return res.status(401).json({ error: { message: 'Invalid API key', type: 'authentication_error' } });
  }
}

export function adminAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = bearer(req) || cookie(req, 'szrouter_admin_session');
    const payload = token ? verifyToken(token) : null;
    if (!payload || payload.type !== 'admin') throw new Error('Invalid token');
    req.admin = { role: 'ADMIN' };
    next();
  } catch {
    res.status(401).json({ error: { message: 'Administrator authentication required' } });
  }
}

export function internalAuth(req: Request, res: Response, next: NextFunction) {
  if (req.headers['x-internal-token'] !== config.INTERNAL_API_TOKEN) {
    return res.status(401).json({ error: { message: 'Internal authentication required' } });
  }
  next();
}
