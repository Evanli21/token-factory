import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(16).default('local-development-secret-change-me'),
  API_KEY_PEPPER: z.string().default('local-api-key-pepper'),
  ADMIN_PASSWORD: z.string().min(8).default('change-this-admin-password'),
  INTERNAL_API_TOKEN: z.string().default('local-internal-token'),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001'),
  DEFAULT_USER_CREDIT: z.coerce.number().nonnegative().default(5),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  CIRCUIT_BREAKER_FAILURES: z.coerce.number().int().positive().default(3),
  CIRCUIT_BREAKER_RESET_SECONDS: z.coerce.number().int().positive().default(60),
  RESERVATION_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  AGENT_CHAT_API_KEY: z.string().default(''),
  AGENT_CHAT_BASE_URL: z.string().default(''),
  AGENT_CHAT_MODEL: z.string().default('gpt-4o-mini'),
  RAG_CHAT_API_KEY: z.string().default(''),
  RAG_CHAT_BASE_URL: z.string().default(''),
  RAG_CHAT_MODEL: z.string().default('gpt-4o-mini'),
  UPLOAD_DIR: z.string().default('./uploads'),
});

export const config = schema.parse(process.env);
export const corsOrigins = config.CORS_ORIGINS.split(',').map((value) => value.trim());
