import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { prisma } from '@token-factory/database';
import { z } from 'zod';
import { adminAuth } from '../middleware/auth.js';
import { maskSecret } from '../lib/security.js';

export const adminRouter = Router();
adminRouter.use(adminAuth);

adminRouter.get('/overview', async (_req, res) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [users, models, channels, openAlerts, usage, revenue, recent] = await Promise.all([
    prisma.user.count(),
    prisma.model.count({ where: { enabled: true } }),
    prisma.channel.count({ where: { status: 'ACTIVE' } }),
    prisma.systemAlert.count({ where: { status: 'OPEN' } }),
    prisma.usageLog.count({ where: { createdAt: { gte: since } } }),
    prisma.usageLog.aggregate({ where: { createdAt: { gte: since }, status: 'SUCCESS' }, _sum: { cost: true } }),
    prisma.usageLog.findMany({ orderBy: { createdAt: 'desc' }, take: 8, include: { user: { select: { email: true } }, model: { select: { slug: true } } } }),
  ]);
  res.json({ metrics: { users, models, channels, openAlerts, requests24h: usage, revenue24h: revenue._sum.cost || 0 }, recent });
});

adminRouter.get('/users', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  const data = await prisma.user.findMany({ where: query ? { OR: [{ email: { contains: query, mode: 'insensitive' } }, { name: { contains: query, mode: 'insensitive' } }] } : {}, select: { id: true, email: true, name: true, role: true, status: true, monthlyQuota: true, createdAt: true, wallet: true }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ data });
});

adminRouter.patch('/users/:id', async (req, res, next) => {
  try {
    const input = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']).optional(), monthlyQuota: z.number().nonnegative().nullable().optional() }).parse(req.body);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: req.params.id } });
    const user = await prisma.user.update({ where: { id: req.params.id }, data: input });
    await prisma.auditLog.create({ data: { actorType: 'ADMIN', action: 'UPDATE', resource: 'User', resourceId: user.id, before: { status: before.status }, after: input } });
    res.json(user);
  } catch (error) { next(error); }
});

adminRouter.get('/models', async (_req, res) => res.json({ data: await prisma.model.findMany({ include: { channelModels: { include: { channel: { select: { id: true, name: true, status: true } } } } }, orderBy: { createdAt: 'desc' } }) }));

adminRouter.post('/models', async (req, res, next) => {
  try {
    const input = z.object({ slug: z.string().min(1), name: z.string().min(1), provider: z.string().min(1), description: z.string().optional(), contextWindow: z.number().int().positive().default(128000), inputPrice: z.number().nonnegative().default(0), outputPrice: z.number().nonnegative().default(0), embeddingPrice: z.number().nonnegative().default(0), enabled: z.boolean().default(true) }).parse(req.body);
    res.status(201).json(await prisma.model.create({ data: input }));
  } catch (error) { next(error); }
});

adminRouter.patch('/models/:id', async (req, res, next) => {
  try {
    const input = z.object({ name: z.string().min(1).optional(), description: z.string().nullable().optional(), inputPrice: z.number().nonnegative().optional(), outputPrice: z.number().nonnegative().optional(), embeddingPrice: z.number().nonnegative().optional(), enabled: z.boolean().optional() }).parse(req.body);
    res.json(await prisma.model.update({ where: { id: req.params.id }, data: input }));
  } catch (error) { next(error); }
});

adminRouter.get('/channels', async (_req, res) => {
  const channels = await prisma.channel.findMany({ include: { channelModels: { include: { model: { select: { id: true, slug: true } } } } }, orderBy: { priority: 'asc' } });
  res.json({ data: channels.map((channel) => ({ ...channel, apiKeyEncrypted: maskSecret(channel.apiKeyEncrypted) })) });
});

adminRouter.post('/channels', async (req, res, next) => {
  try {
    const input = z.object({ name: z.string().min(1), provider: z.string().min(1), baseUrl: z.string().url(), apiKey: z.string().min(1), priority: z.number().int().default(10), weight: z.number().int().positive().default(100), models: z.array(z.object({ modelId: z.string(), upstreamModel: z.string() })).default([]) }).parse(req.body);
    const channel = await prisma.channel.create({ data: { name: input.name, provider: input.provider, baseUrl: input.baseUrl, apiKeyEncrypted: input.apiKey, priority: input.priority, weight: input.weight, channelModels: { create: input.models } }, include: { channelModels: true } });
    await prisma.auditLog.create({ data: { actorType: 'ADMIN', action: 'CREATE', resource: 'Channel', resourceId: channel.id, after: { name: channel.name, baseUrl: channel.baseUrl } } });
    res.status(201).json({ ...channel, apiKeyEncrypted: maskSecret(channel.apiKeyEncrypted) });
  } catch (error) { next(error); }
});

adminRouter.patch('/channels/:id', async (req, res, next) => {
  try {
    const input = z.object({ status: z.enum(['ACTIVE', 'DISABLED']).optional(), priority: z.number().int().optional(), weight: z.number().int().positive().optional() }).parse(req.body);
    res.json(await prisma.channel.update({ where: { id: req.params.id }, data: input, select: { id: true, name: true, status: true, priority: true, weight: true } }));
  } catch (error) { next(error); }
});

adminRouter.get('/orders', async (_req, res) => res.json({ data: await prisma.order.findMany({ include: { user: { select: { email: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }) }));

adminRouter.get('/cards', async (_req, res) => res.json({ data: await prisma.card.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }) }));
adminRouter.post('/cards', async (req, res, next) => {
  try {
    const { amount, count, expiresAt } = z.object({ amount: z.number().positive(), count: z.number().int().min(1).max(100), expiresAt: z.string().datetime().optional() }).parse(req.body);
    const codes = Array.from({ length: count }, () => `TF-${randomBytes(10).toString('hex').toUpperCase()}`);
    await prisma.card.createMany({ data: codes.map((code) => ({ codeHash: createHash('sha256').update(code).digest('hex'), codePrefix: code.slice(0, 9), amount, expiresAt: expiresAt ? new Date(expiresAt) : undefined })) });
    res.status(201).json({ codes, warning: 'Card codes are only returned once.' });
  } catch (error) { next(error); }
});

adminRouter.get('/usage-logs', async (_req, res) => res.json({ data: await prisma.usageLog.findMany({ include: { user: { select: { email: true } }, model: { select: { slug: true } }, channel: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }) }));
adminRouter.get('/moderation', async (_req, res) => {
  const [rules, logs] = await Promise.all([prisma.moderationRule.findMany({ orderBy: { priority: 'asc' } }), prisma.moderationLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })]);
  res.json({ rules, logs });
});
adminRouter.post('/moderation/rules', async (req, res, next) => {
  try { res.status(201).json(await prisma.moderationRule.create({ data: z.object({ name: z.string(), type: z.enum(['KEYWORD', 'REGEX']).default('KEYWORD'), pattern: z.string().min(1), action: z.enum(['BLOCK', 'LOG']).default('BLOCK'), priority: z.number().int().default(10) }).parse(req.body) })); } catch (error) { next(error); }
});

adminRouter.get('/agents', async (_req, res) => res.json({ data: await prisma.agentProfile.findMany({ include: { user: { select: { email: true } } }, orderBy: { createdAt: 'desc' } }) }));
adminRouter.get('/withdrawals', async (_req, res) => res.json({ data: await prisma.withdrawal.findMany({ include: { user: { select: { email: true } } }, orderBy: { createdAt: 'desc' } }) }));
adminRouter.patch('/withdrawals/:id', async (req, res, next) => {
  try { res.json(await prisma.withdrawal.update({ where: { id: req.params.id }, data: z.object({ status: z.enum(['APPROVED', 'REJECTED', 'PAID']), note: z.string().optional() }).parse(req.body) })); } catch (error) { next(error); }
});

adminRouter.get('/finance', async (_req, res) => {
  const [wallets, transactions, invoices] = await Promise.all([prisma.organizationWallet.findMany({ include: { organization: { select: { name: true } } } }), prisma.organizationTransaction.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }), prisma.monthlyInvoice.findMany({ include: { organization: { select: { name: true } } }, orderBy: { month: 'desc' }, take: 100 })]);
  res.json({ wallets, transactions, invoices });
});

adminRouter.get('/alerts', async (_req, res) => res.json({ data: await prisma.systemAlert.findMany({ orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 100 }) }));
adminRouter.patch('/alerts/:id', async (req, res) => {
  const status = req.body?.status === 'RESOLVED' ? 'RESOLVED' : 'ACKNOWLEDGED';
  res.json(await prisma.systemAlert.update({ where: { id: req.params.id }, data: status === 'RESOLVED' ? { status, resolvedAt: new Date() } : { status, acknowledgedAt: new Date() } }));
});

adminRouter.get('/tasks', async (_req, res) => {
  const [exports, documents, deliveries, evalRuns] = await Promise.all([prisma.exportTask.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }), prisma.document.findMany({ where: { status: { in: ['PENDING', 'PROCESSING', 'FAILED'] } }, orderBy: { updatedAt: 'desc' }, take: 50 }), prisma.webhookDelivery.findMany({ where: { status: { not: 'DELIVERED' } }, orderBy: { createdAt: 'desc' }, take: 50 }), prisma.knowledgeEvalRun.findMany({ where: { status: { not: 'COMPLETED' } }, take: 50 })]);
  res.json({ exports, documents, deliveries, evalRuns });
});

adminRouter.get('/audit-logs', async (_req, res) => res.json({ data: await prisma.auditLog.findMany({ include: { user: { select: { email: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }) }));
