import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { config } from '../config.js';

export type UserToken = JwtPayload & { sub: string; type: 'user' };

export function apiKeyHash(value: string) {
  return createHash('sha256').update(`${value}:${config.API_KEY_PEPPER}`).digest('hex');
}

export function issueApiKey() {
  const value = `tf_${randomBytes(30).toString('base64url')}`;
  return { value, prefix: value.slice(0, 12), hash: apiKeyHash(value) };
}

export function issueUserToken(userId: string) {
  return jwt.sign({ type: 'user' }, config.JWT_SECRET, { subject: userId, expiresIn: '7d' });
}

export function issueAdminToken() {
  return jwt.sign({ type: 'admin' }, config.JWT_SECRET, { subject: 'admin', expiresIn: '12h' });
}

export function verifyToken(value: string) {
  return jwt.verify(value, config.JWT_SECRET) as JwtPayload & { type?: string };
}

export function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function maskSecret(value: string) {
  return value.length < 9 ? '••••••••' : `${value.slice(0, 4)}…${value.slice(-4)}`;
}
