import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { prisma } from '@szrouter/database';
import { z } from 'zod';
import { config } from '../config.js';
import { userAuth } from '../middleware/auth.js';
import { issueApiKey } from '../lib/security.js';

export const accountRouter = Router();
accountRouter.use(userAuth);

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
  const models = await prisma.model.findMany({ where: { enabled: true }, orderBy: { name: 'asc' }, include: { channelModels: { where: { enabled: true }, select: { inputPrice: true, outputPrice: true } } } });
  res.json({ data: models.map(({ channelModels, ...model }) => ({ ...model, inputCost: channelModels.map((item) => item.inputPrice).filter((value) => value != null).sort((a, b) => Number(a) - Number(b))[0] || 0, outputCost: channelModels.map((item) => item.outputPrice).filter((value) => value != null).sort((a, b) => Number(a) - Number(b))[0] || 0 })) });
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

accountRouter.patch('/api-keys/:id', async (req, res, next) => {
  try {
    const input = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }).parse(req.body);
    const result = await prisma.apiKey.updateMany({
      where: { id: req.params.id, userId: req.auth!.user.id, status: { not: 'REVOKED' } },
      data: { status: input.status },
    });
    if (!result.count) return res.status(404).json({ error: { message: 'API key not found' } });
    res.json({ id: req.params.id, status: input.status });
  } catch (error) { next(error); }
});

accountRouter.get('/orders', async (req, res) => {
  res.json({ data: await prisma.order.findMany({ where: { userId: req.auth!.user.id }, orderBy: { createdAt: 'desc' }, take: 50 }) });
});

accountRouter.get('/transactions', async (req, res) => {
  const wallet = await prisma.wallet.findUnique({ where: { userId: req.auth!.user.id } });
  const data = wallet ? await prisma.transaction.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: 'desc' }, take: 100 }) : [];
  res.json({ data });
});

accountRouter.post('/orders', async (req, res, next) => {
  try {
    const { amount } = z.object({ amount: z.number().min(1).max(100_000) }).parse(req.body);
    const order = await prisma.order.create({ data: { userId: req.auth!.user.id, orderNo: `SZ${Date.now()}${randomBytes(3).toString('hex').toUpperCase()}`, amount } });
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

async function organizationMember(organizationId: string, userId: string) {
  return prisma.orgMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
}

accountRouter.get('/organizations/:id/members', async (req, res) => {
  const membership = await organizationMember(req.params.id, req.auth!.user.id);
  if (!membership || membership.status !== 'ACTIVE') return res.status(403).json({ error: { message: 'Organization access denied' } });
  const data = await prisma.orgMember.findMany({
    where: { organizationId: req.params.id },
    include: { user: { select: { id: true, email: true, name: true, status: true } } },
    orderBy: { joinedAt: 'asc' },
  });
  res.json({ data });
});

accountRouter.post('/organizations/:id/members', async (req, res, next) => {
  try {
    const membership = await organizationMember(req.params.id, req.auth!.user.id);
    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) return res.status(403).json({ error: { message: 'Organization administrator access required' } });
    const input = z.object({ email: z.string().email(), role: z.enum(['ADMIN', 'MEMBER', 'BILLING']).default('MEMBER') }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email.trim().toLocaleLowerCase() } });
    if (!user) return res.status(404).json({ error: { message: 'User must register before being invited' } });
    const member = await prisma.orgMember.upsert({
      where: { organizationId_userId: { organizationId: req.params.id, userId: user.id } },
      create: { organizationId: req.params.id, userId: user.id, role: input.role },
      update: { role: input.role, status: 'ACTIVE' },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    res.status(201).json(member);
  } catch (error) { next(error); }
});

accountRouter.patch('/organizations/:id/members/:memberId', async (req, res, next) => {
  try {
    const membership = await organizationMember(req.params.id, req.auth!.user.id);
    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) return res.status(403).json({ error: { message: 'Organization administrator access required' } });
    const input = z.object({ role: z.enum(['ADMIN', 'MEMBER', 'BILLING']).optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional() }).parse(req.body);
    const result = await prisma.orgMember.updateMany({ where: { id: req.params.memberId, organizationId: req.params.id, role: { not: 'OWNER' } }, data: input });
    if (!result.count) return res.status(404).json({ error: { message: 'Member not found or cannot be changed' } });
    res.json({ id: req.params.memberId, ...input });
  } catch (error) { next(error); }
});

accountRouter.get('/organizations/:id/billing', async (req, res) => {
  const membership = await organizationMember(req.params.id, req.auth!.user.id);
  if (!membership || membership.status !== 'ACTIVE') return res.status(403).json({ error: { message: 'Organization access denied' } });
  const [wallet, transactions, invoices] = await Promise.all([
    prisma.organizationWallet.findUnique({ where: { organizationId: req.params.id } }),
    prisma.organizationTransaction.findMany({ where: { organizationId: req.params.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.monthlyInvoice.findMany({ where: { organizationId: req.params.id }, orderBy: { month: 'desc' }, take: 24 }),
  ]);
  res.json({ wallet, transactions, invoices });
});

accountRouter.get('/organizations/:id/analytics', async (req, res) => {
  const membership = await organizationMember(req.params.id, req.auth!.user.id);
  if (!membership || membership.status !== 'ACTIVE') return res.status(403).json({ error: { message: 'Organization access denied' } });
  const since = new Date(Date.now() - 30 * 86400_000);
  const [summary, byModel] = await Promise.all([
    prisma.usageLog.aggregate({ where: { organizationId: req.params.id, createdAt: { gte: since } }, _count: true, _sum: { promptTokens: true, completionTokens: true, cost: true } }),
    prisma.usageLog.groupBy({ by: ['modelId'], where: { organizationId: req.params.id, createdAt: { gte: since } }, _count: true, _sum: { cost: true, promptTokens: true, completionTokens: true } }),
  ]);
  res.json({
    period: '30d',
    summary: {
      requests: summary._count,
      promptTokens: String(summary._sum.promptTokens || 0),
      completionTokens: String(summary._sum.completionTokens || 0),
      cost: summary._sum.cost || 0,
    },
    byModel: byModel.map((row) => ({
      modelId: row.modelId,
      requests: row._count,
      promptTokens: String(row._sum.promptTokens || 0),
      completionTokens: String(row._sum.completionTokens || 0),
      cost: row._sum.cost || 0,
    })),
  });
});

accountRouter.get('/organizations/:id/resources', async (req, res) => {
  const membership = await organizationMember(req.params.id, req.auth!.user.id);
  if (!membership || membership.status !== 'ACTIVE') return res.status(403).json({ error: { message: 'Organization access denied' } });
  const [apiKeys, apps, workflows] = await Promise.all([
    prisma.apiKey.findMany({ where: { organizationId: req.params.id }, select: { id: true, name: true, keyPrefix: true, status: true, lastUsedAt: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
    prisma.agentApp.findMany({ where: { organizationId: req.params.id }, select: { id: true, name: true, slug: true, status: true, visibility: true, updatedAt: true }, orderBy: { updatedAt: 'desc' } }),
    prisma.agentWorkflow.findMany({ where: { organizationId: req.params.id }, select: { id: true, name: true, slug: true, status: true, version: true, updatedAt: true }, orderBy: { updatedAt: 'desc' } }),
  ]);
  res.json({ apiKeys, apps, workflows });
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
    await prisma.backgroundJob.create({ data: { type: 'knowledge_parse', payload: { documentId: document.id } } });
    res.status(202).json(document);
  } catch (error) { next(error); }
});

accountRouter.get('/knowledge-bases/:id/documents', async (req, res) => {
  const kb = await prisma.knowledgeBase.findFirst({ where: { id: req.params.id, userId: req.auth!.user.id } });
  if (!kb) return res.status(404).json({ error: { message: 'Knowledge base not found' } });
  const data = await prisma.document.findMany({ where: { knowledgeBaseId: kb.id }, orderBy: { createdAt: 'desc' } });
  res.json({ data });
});

accountRouter.delete('/knowledge-bases/:id/documents/:documentId', async (req, res) => {
  const result = await prisma.document.deleteMany({ where: { id: req.params.documentId, knowledgeBaseId: req.params.id, knowledgeBase: { userId: req.auth!.user.id } } });
  if (!result.count) return res.status(404).json({ error: { message: 'Document not found' } });
  res.status(204).end();
});

accountRouter.post('/knowledge-bases/:id/documents/:documentId/reindex', async (req, res) => {
  const document = await prisma.document.findFirst({ where: { id: req.params.documentId, knowledgeBaseId: req.params.id, knowledgeBase: { userId: req.auth!.user.id } } });
  if (!document) return res.status(404).json({ error: { message: 'Document not found' } });
  await prisma.document.update({ where: { id: document.id }, data: { status: 'PENDING', errorMessage: null } });
  await prisma.backgroundJob.create({ data: { type: 'knowledge_parse', payload: { documentId: document.id } } });
  res.status(202).json({ id: document.id, status: 'PENDING' });
});

accountRouter.get('/knowledge-bases/:id/documents/:documentId/chunks', async (req, res) => {
  const document = await prisma.document.findFirst({ where: { id: req.params.documentId, knowledgeBaseId: req.params.id, knowledgeBase: { userId: req.auth!.user.id } } });
  if (!document) return res.status(404).json({ error: { message: 'Document not found' } });
  const data = await prisma.$queryRaw<Array<{ id: string; content: string; tokens: number | null; metadata: unknown; createdAt: Date }>>`
    SELECT id, content, tokens, metadata, "createdAt"
    FROM "DocumentChunk"
    WHERE "documentId" = ${document.id}
    ORDER BY "createdAt" ASC
    LIMIT 500
  `;
  res.json({ data, source: { name: document.name } });
});

accountRouter.get('/knowledge-bases/:id/documents/:documentId/download', async (req, res) => {
  const document = await prisma.document.findFirst({ where: { id: req.params.documentId, knowledgeBaseId: req.params.id, knowledgeBase: { userId: req.auth!.user.id } } });
  if (!document) return res.status(404).json({ error: { message: 'Document not found' } });
  res.download(document.storageKey, document.name);
});

accountRouter.delete('/knowledge-bases/:id', async (req, res) => {
  const result = await prisma.knowledgeBase.deleteMany({ where: { id: req.params.id, userId: req.auth!.user.id } });
  if (!result.count) return res.status(404).json({ error: { message: 'Knowledge base not found' } });
  res.status(204).end();
});

accountRouter.get('/agent-apps', async (req, res) => {
  res.json({ data: await prisma.agentApp.findMany({ where: { OR: [{ userId: req.auth!.user.id }, { visibility: 'PUBLIC', status: 'ACTIVE' }] }, select: { id: true, userId: true, name: true, slug: true, description: true, avatarUrl: true, modelSlug: true, pricePerRun: true, visibility: true, status: true, updatedAt: true }, orderBy: { updatedAt: 'desc' } }) });
});

accountRouter.post('/agent-apps', async (req, res, next) => {
  try {
    const input = z.object({ name: z.string().min(1).max(100), slug: z.string().regex(/^[a-z0-9-]+$/), description: z.string().max(2000).optional(), systemPrompt: z.string().min(1).max(50_000), modelSlug: z.string().min(1), organizationId: z.string().optional(), pricePerRun: z.number().nonnegative().default(0) }).parse(req.body);
    if (input.organizationId && !(await organizationMember(input.organizationId, req.auth!.user.id))) return res.status(403).json({ error: { message: 'Organization access denied' } });
    const app = await prisma.agentApp.create({ data: { userId: req.auth!.user.id, ...input } });
    res.status(201).json(app);
  } catch (error) { next(error); }
});

accountRouter.get('/agent-apps/:id', async (req, res) => {
  const app = await prisma.agentApp.findFirst({ where: { OR: [{ id: req.params.id }, { slug: req.params.id }], AND: [{ OR: [{ userId: req.auth!.user.id }, { visibility: 'PUBLIC', status: 'ACTIVE' }] }] }, include: { tools: true } });
  if (!app) return res.status(404).json({ error: { message: 'Agent app not found' } });
  res.json(app);
});

accountRouter.patch('/agent-apps/:id', async (req, res, next) => {
  try {
    const input = z.object({ name: z.string().min(1).max(100).optional(), description: z.string().max(2000).nullable().optional(), systemPrompt: z.string().min(1).max(50_000).optional(), modelSlug: z.string().min(1).optional(), pricePerRun: z.number().nonnegative().optional(), visibility: z.enum(['PRIVATE', 'PUBLIC']).optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional() }).parse(req.body);
    const owned = await prisma.agentApp.findFirst({ where: { id: req.params.id, userId: req.auth!.user.id } });
    if (!owned) return res.status(404).json({ error: { message: 'Agent app not found' } });
    res.json(await prisma.agentApp.update({ where: { id: owned.id }, data: input }));
  } catch (error) { next(error); }
});

accountRouter.post('/agent-apps/:id/publish', async (req, res) => {
  const owned = await prisma.agentApp.findFirst({ where: { id: req.params.id, userId: req.auth!.user.id } });
  if (!owned) return res.status(404).json({ error: { message: 'Agent app not found' } });
  res.json(await prisma.agentApp.update({ where: { id: owned.id }, data: { visibility: 'PUBLIC', status: 'ACTIVE' } }));
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
    const input = z.object({ name: z.string().min(1), slug: z.string().regex(/^[a-z0-9-]+$/), definition: z.unknown(), organizationId: z.string().optional() }).parse(req.body);
    if (input.organizationId && !(await organizationMember(input.organizationId, req.auth!.user.id))) return res.status(403).json({ error: { message: 'Organization access denied' } });
    res.status(201).json(await prisma.agentWorkflow.create({ data: { userId: req.auth!.user.id, name: input.name, slug: input.slug, definition: input.definition as object, organizationId: input.organizationId } }));
  } catch (error) { next(error); }
});

accountRouter.patch('/workflows/:id', async (req, res, next) => {
  try {
    const input = z.object({ name: z.string().min(1).optional(), description: z.string().max(2000).nullable().optional(), definition: z.unknown().optional(), status: z.enum(['DRAFT', 'ACTIVE', 'DISABLED']).optional() }).parse(req.body);
    const owned = await prisma.agentWorkflow.findFirst({ where: { id: req.params.id, userId: req.auth!.user.id } });
    if (!owned) return res.status(404).json({ error: { message: 'Workflow not found' } });
    const definition = input.definition === undefined ? undefined : input.definition as object;
    res.json(await prisma.agentWorkflow.update({ where: { id: owned.id }, data: { ...input, definition, version: { increment: 1 } } }));
  } catch (error) { next(error); }
});

accountRouter.post('/workflows/:id/publish', async (req, res) => {
  const owned = await prisma.agentWorkflow.findFirst({ where: { id: req.params.id, userId: req.auth!.user.id } });
  if (!owned) return res.status(404).json({ error: { message: 'Workflow not found' } });
  const workflow = await prisma.agentWorkflow.update({ where: { id: owned.id }, data: { status: 'ACTIVE', version: { increment: 1 } } });
  res.json({ ...workflow, shareUrl: `${config.NEXT_PUBLIC_BASE_URL || ''}/workflows/${workflow.slug}`, embedCode: `<iframe src="${config.NEXT_PUBLIC_BASE_URL || ''}/workflows/${workflow.slug}" title="${workflow.name}"></iframe>` });
});

accountRouter.get('/exports', async (req, res) => {
  res.json({ data: await prisma.exportTask.findMany({ where: { userId: req.auth!.user.id }, orderBy: { createdAt: 'desc' } }) });
});

accountRouter.get('/exports/:id/download', async (req, res) => {
  const task = await prisma.exportTask.findFirst({ where: { id: req.params.id, userId: req.auth!.user.id, status: 'COMPLETED' } });
  if (!task?.fileUrl) return res.status(404).json({ error: { message: 'Export file is not ready' } });
  res.download(task.fileUrl, `szrouter-${task.type.toLocaleLowerCase()}-${task.id}.${task.format.toLocaleLowerCase()}`);
});

accountRouter.post('/exports', async (req, res, next) => {
  try {
    const input = z.object({ type: z.enum(['USAGE', 'TRANSACTIONS', 'ORDERS']), format: z.enum(['CSV', 'JSON']).default('CSV') }).parse(req.body);
    const task = await prisma.exportTask.create({ data: { userId: req.auth!.user.id, ...input } });
    await prisma.backgroundJob.create({ data: { type: 'export_task', payload: { exportTaskId: task.id } } });
    res.status(202).json(task);
  } catch (error) { next(error); }
});
