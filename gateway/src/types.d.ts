import type { ApiKey, User } from '@szrouter/database';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        user: User;
        apiKey?: ApiKey;
        organizationId?: string;
      };
      admin?: { role: 'ADMIN' };
      requestId?: string;
    }
  }
}

export {};
