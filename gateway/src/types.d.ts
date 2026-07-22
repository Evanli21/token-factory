import type { ApiKey, User } from '@token-factory/database';

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
