import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Queue } from 'bullmq';
import { Router } from 'express';
import multer from 'multer';
import { prisma } from '@token-factory/database';
import { z } from 'zod';
import { config } from '../config.js';
import { userAuth } from '../middleware/auth.js';
import { issueApiKey } from '../lib/security.js';

export const accountRouter = Router();
accountRouter.use(userAuth);

const queue = new Queue('token-factory', { connection: { url: config.REDIS_URL }, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 200 } });
queue.on('error', () => undefined);

mkdirSync(config.UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: config.UPLOAD_DIR,
    filename: (_req, file, callback) => callback(null, `${Date.now()}-${randomBytes(8).toString('hex')}${path.extname(file.originalname).toLocaleLowerCase()}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(null, ['.pdf', '.docx', '.txt', '.md'].includes(path.extname(file.originalname).toLocaleLowerCase())),
});

accountRouter.get('/me', async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.auth!.user.id },
    select: { id: true, email: true, name: true, role: true, createdAt: true, wallet: { select: { balance: true, frozen: true, currency: true } } },
  });
  res.json(user);
});

accountRouter.get('/models', async (_req, res) => {
  const models = await prisma.model.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } });
  res.json({ data: models });
});

accountRouter.get('/api-keys', async (req, res) => {
  const keys = await prisma.apiKey.findMany({ where: { userId: req.auth!.user.id }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, keyPrefix: true, status: true, lastUsedAt: true, expiresAt: true, rateLimit: true, createdAt: true } });
  res.json({ data: keys });
});

accountRouter.post('/api-keys', async (req, res, next) => {
  try {
    const input = z.object({ name: z.string().min(1).max(80), organizationId: z.string().optional(), rateLimit: z.number().int().positive().max(10_000).optional() }).parse(req.body);
    if (input.organizationId) {
      const member = await prisma.orgMember.findUnique({ where: { organizationId_userId: { organizationId: input.organizationId, userId: req.auth!.user.id } } });
      if (!member || member.status !== 'ACTIVE') return res.status(403).json({ error: { message: 'Organization access denied' } });
    }
    const generated = issueApiKey();
    const key = await prisma.apiKey.create({ data: { userId: req.auth!.user.id, organizationId: input.organizationId, name: input.name, keyPrefix: generated.prefix, keyHash: generated.hash, rateLimit: input.rateLimit } });
    res.status(201).json({ id: key.id, name: key.name, key: generated.value, prefix: generated.prefix, warning: 'Copy this key now. It will not be shown again.' });
  } catch (error) { next(error); }
});

accountRouter.delete('/api-keys/:id', async (req, res) => {
  const result = await prisma.apiKey.updateMany({ where: { id: req.params.id, userId: req.auth!.user.id }, data: { status: 'REVOKED' } });
  if (!result.count) return res.status(404).json({ error: { message: 'API key not found' } });
  res.status(204).end();
});

accountRouter.get('/orders', async (req, res) => {
  res.json({ data: await prisma.order.findMany({ where: { userId: req.auth!.user.id }, orderBy: { createdAt: 'desc' }, take: 50 }) });
});

accountRouter.post('/orders', async (req, res, next) => {
  try {
    const { amount } = z.object({ amount: z.number().min(1).max(100_000) }).parse(req.body);
    const order = await prisma.order.create({ data: { userId: req.auth!.user.id, orderNo: `TF${Date.now()}${randomBytes(3).toString('hex').toUpperCase()}`, amount } });
    res.status(201).json({ ...order, payment: { status: 'integration_required', message: 'Connect a payment provider webhook before accepting production payments.' } });
  } catch (error) { next(error); }
});

accountRouter.post('/cards/redeem', async (req, res, next) => {
  try {
    const { code } = z.object({ code: z.string().min(8) }).parse(req.body);
    const codeHash = createHash('sha256').update(code).digest('hex');
    const result = await prisma.$transaction(async (tx) => {
      const card = await tx.card.findUnique({ where: { codeHash } });
      if (!card || card.status !== 'ACTIVE' || (card.expiresAt && card.expiresAt < new Date())) throw new Error('Card is invalid or expired');
      const wallet = await tx.wallet.update({ where: { userId: req.auth!.user.id }, data: { balance: { increment: card.amount } } });
      await tx.card.update({ where: { id: card.id }, data: { status: 'REDEEMED', redeemedById: req.auth!.user.id, redeemedAt: new Date() } });
      await tx.transaction.create({ data: { walletId: wallet.id, type: 'CARD_REDEEM', amount: card.amount, balance: wallet.balance, referenceId: card.id } });
      return wallet;
    });
    res.json({ balance: result.balance });
  } catch (error) { next(error); }
});

accountRouter.get('/organizations', async (req, res) => {
  const organizations = await prisma.organization.findMany({ where: { members: { some: { userId: req.auth!.user.id, status: 'ACTIVE' } } }, include: { wallet: true, _count: { select: { members: true } } } });
  res.json({ data: organizations });
});

accountRouter.post('/organizations', async (req, res, next) => {
  try {
    const input = z.object({ name: z.string().min(2).max(100), slug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(60) }).parse(req.body);
    const organization = await prisma.organization.create({ data: { name: input.name, slug: input.slug, ownerId: req.auth!.user.id, wallet: { create: {} }, members: { create: { userId: req.auth!.user.id, role: 'OWNER' } } }, include: { wallet: true } });
    res.status(201).json(organization);
  } catch (error) { next(error); }
});

accountRouter.get('/knowledge-bases', async (req, res) => {
  const data = await prisma.knowledgeBase.findMany({ where: { userId: req.auth!.user.id }, include: { _count: { select: { documents: true } } }, orderBy: { createdAt: 'desc' } });
  res.json({ data });
});

accountRouter.post('/knowledge-bases', async (req, res, next) => {
  try {
    const input = z.object({ name: z.string().min(1).max(100), description: z.string().max(1000).optional() }).parse(req.body);
    res.status(201).json(await prisma.knowledgeBase.create({ data: { userId: req.auth!.user.id, ...input } }));
  } catch (error) { next(error); }
});

accountRouter.post('/knowledge-bases/:id/documents', upload.single('file'), async (req, res, next) => {
  try {
    const kb = await prisma.knowledgeBase.findFirst({ where: { id: String(req.params.id), userId: req.auth!.user.id } });
    if (!kb) return res.status(404).json({ error: { message: 'Knowledge base not found' } });
    if (!req.file) return res.status(400).json({ error: { message: 'A PDF, DOCX, TXT, or MD file is required' } });
    const document = await prisma.document.create({ data: { knowledgeBaseId: kb.id, name: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size, storageKey: req.file.path } });
    await queue.add('parse-document', { documentId: document.id });
    res.status(202).json(document);
  } catch (error) { next(error); }
});

accountRouter.get('/agent-apps', async (_req, res) => {
  res.json({ data: await prisma.agentApp.findMany({ where: { visibility: 'PUBLIC', status: 'ACTIVE' }, select: { id: true, name: true, slug: true, description: true, avatarUrl: true, modelSlug: true, pricePerRun: true } }) });
});

accountRouter.get('/workflows', async (req, res) => {
  const [workflows, templates] = await Promise.all([
    prisma.agentWorkflow.findMany({ where: { userId: req.auth!.user.id }, orderBy: { updatedAt: 'desc' } }),
    prisma.workflowTemplate.findMany({ orderBy: [{ featured: 'desc' }, { name: 'asc' }] }),
  ]);
  res.json({ data: workflows, templates });
});

accountRouter.post('/workflows', async (req, res, next) => {
  try {
    const input = z.object({ name: z.string().min(1), slug: z.string().regex(/^[a-z0-9-]+$/), definition: z.unknown() }).parse(req.body);
    res.status(201).json(await prisma.agentWorkflow.create({ data: { userId: req.auth!.user.id, name: input.name, slug: input.slug, definition: input.definition as object } }));
  } catch (error) { next(error); }
});

accountRouter.get('/exports', async (req, res) => {
  res.json({ data: await prisma.exportTask.findMany({ where: { userId: req.auth!.user.id }, orderBy: { createdAt: 'desc' } }) });
});

accountRouter.post('/exports', async (req, res, next) => {
  try {
    const input = z.object({ type: z.enum(['USAGE', 'TRANSACTIONS', 'ORDERS']), format: z.enum(['CSV', 'JSON']).default('CSV') }).parse(req.body);
    const task = await prisma.exportTask.create({ data: { userId: req.auth!.user.id, ...input } });
    await queue.add('export', { exportTaskId: task.id });
    res.status(202).json(task);
  } catch (error) { next(error); }
});
