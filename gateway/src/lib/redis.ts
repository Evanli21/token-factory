import { Redis } from 'ioredis';
import { config } from '../config.js';

export const redis = new Redis(config.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
});

redis.on('error', () => undefined);

let attempted = false;

export async function ensureRedis() {
  if (redis.status === 'ready') return true;
  if (attempted && redis.status === 'end') return false;
  attempted = true;
  try {
    if (redis.status === 'wait') await redis.connect();
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

const memoryCounters = new Map<string, { count: number; expires: number }>();

export async function hitRateLimit(key: string, limit: number) {
  if (await ensureRedis()) {
    const bucket = `rate:${key}:${Math.floor(Date.now() / 60_000)}`;
    const count = await redis.incr(bucket);
    if (count === 1) await redis.expire(bucket, 65);
    return { allowed: count <= limit, count, limit };
  }

  const now = Date.now();
  const current = memoryCounters.get(key);
  const entry = !current || current.expires < now ? { count: 0, expires: now + 60_000 } : current;
  entry.count += 1;
  memoryCounters.set(key, entry);
  return { allowed: entry.count <= limit, count: entry.count, limit };
}

export async function circuitOpen(channelId: string) {
  if (!(await ensureRedis())) return false;
  return Boolean(await redis.get(`circuit:open:${channelId}`));
}

export async function channelSucceeded(channelId: string) {
  if (!(await ensureRedis())) return;
  await redis.del(`circuit:failures:${channelId}`, `circuit:open:${channelId}`);
}

export async function channelFailed(channelId: string) {
  if (!(await ensureRedis())) return;
  const key = `circuit:failures:${channelId}`;
  const failures = await redis.incr(key);
  await redis.expire(key, config.CIRCUIT_BREAKER_RESET_SECONDS);
  if (failures >= config.CIRCUIT_BREAKER_FAILURES) {
    await redis.set(`circuit:open:${channelId}`, '1', 'EX', config.CIRCUIT_BREAKER_RESET_SECONDS);
  }
}
