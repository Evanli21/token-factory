import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { Prisma, prisma } from '@token-factory/database';
import { z } from 'zod';
import { config } from '../config.js';
import { issueAdminToken, issueUserToken, safeEqual } from '../lib/security.js';

export const authRouter = Router();

const credentials = z.object({ email: z.string().email(), password: z.string().min(8).max(128), name: z.string().min(1).max(80).optional() });

authRouter.post('/register', async (req, res, next) => {
  try {
    const input = credentials.parse(req.body);
    const email = input.email.trim().toLocaleLowerCase();
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(409).json({ error: { message: 'Email is already registered' } });
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await prisma.user.create({
      data: { email, name: input.name, passwordHash, wallet: { create: { balance: config.DEFAULT_USER_CREDIT } } },
      select: { id: true, email: true, name: true, createdAt: true },
    });
    await prisma.auditLog.create({ data: { userId: user.id, actorType: 'USER', action: 'REGISTER', resource: 'User', resourceId: user.id, ip: req.ip } });
    res.status(201).json({ token: issueUserToken(user.id), user });
  } catch (error) { next(error); }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const input = credentials.omit({ name: true }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email.trim().toLocaleLowerCase() } });
    if (!user || user.status !== 'ACTIVE' || !(await bcrypt.compare(input.password, user.passwordHash))) {
      return res.status(401).json({ error: { message: 'Email or password is incorrect' } });
    }
    res.json({ token: issueUserToken(user.id), user: { id: user.id, email: user.email, name: user.name } });
  } catch (error) { next(error); }
});

authRouter.post('/admin/login', async (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!safeEqual(password, config.ADMIN_PASSWORD)) return res.status(401).json({ error: { message: 'Administrator password is incorrect' } });
  res.json({ token: issueAdminToken() });
});
