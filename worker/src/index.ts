import 'dotenv/config';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Queue, Worker, type Job } from 'bullmq';
import mammoth from 'mammoth';
import pdf from 'pdf-parse';
import PDFDocument from 'pdfkit';
import pino from 'pino';
import { prisma } from '@token-factory/database';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const uploadDir = process.env.UPLOAD_DIR || './uploads';
const exportDir = process.env.EXPORT_DIR || './exports';
const queue = new Queue('token-factory', { connection: { url: redisUrl } });

function enabled(name: string, defaultValue = false) {
  const value = process.env[name];
  return value == null ? defaultValue : value === 'true';
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 3.5));
}

function chunkText(text: string, size: number, overlap: number) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    let end = Math.min(normalized.length, cursor + size);
    if (end < normalized.length) {
      const breakAt = Math.max(normalized.lastIndexOf('\n', end), normalized.lastIndexOf('。', end), normalized.lastIndexOf('. ', end));
      if (breakAt > cursor + size * 0.6) end = breakAt + 1;
    }
    chunks.push(normalized.slice(cursor, end).trim());
    if (end >= normalized.length) break;
    cursor = Math.max(cursor + 1, end - overlap);
  }
  return chunks.filter(Boolean);
}

async function extractText(filePath: string, mimeType: string) {
  const extension = path.extname(filePath).toLocaleLowerCase();
  if (extension === '.pdf' || mimeType === 'application/pdf') return (await pdf(await readFile(filePath))).text;
  if (extension === '.docx' || mimeType.includes('wordprocessingml')) return (await mammoth.extractRawText({ path: filePath })).value;
  return readFile(filePath, 'utf8');
}

function mockEmbedding(text: string) {
  const digest = createHash('sha256').update(text).digest();
  const values = Array.from({ length: 1536 }, (_, index) => (digest[index % digest.length]! / 255) * 2 - 1);
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / norm);
}

async function embed(text: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return mockEmbedding(text);
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small', input: text }) });
  if (!response.ok) throw new Error(`Embedding upstream ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = await response.json() as { data?: Array<{ embedding: number[] }> };
  if (!data.data?.[0]?.embedding) throw new Error('Embedding response was empty');
  return data.data[0].embedding;
}

async function parseDocument(documentId: string, job: Job) {
  const document = await prisma.document.findUnique({ where: { id: documentId }, include: { knowledgeBase: true } });
  if (!document) throw new Error('Document not found');
  await prisma.document.update({ where: { id: document.id }, data: { status: 'PROCESSING', errorMessage: null } });
  try {
    const text = await extractText(document.storageKey, document.mimeType);
    const chunks = chunkText(text, document.knowledgeBase.chunkSize, document.knowledgeBase.chunkOverlap);
    await prisma.$executeRawUnsafe('DELETE FROM "DocumentChunk" WHERE "documentId" = $1', document.id);
    for (let index = 0; index < chunks.length; index++) {
      const content = chunks[index]!;
      const vector = `[${(await embed(content)).map((value) => Number(value).toFixed(8)).join(',')}]`;
      await prisma.$executeRawUnsafe(
        'INSERT INTO "DocumentChunk" (id, "documentId", content, tokens, embedding, metadata) VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb)',
        randomUUID(), document.id, content, estimateTokens(content), vector, JSON.stringify({ index, documentName: document.name }),
      );
      await job.updateProgress(Math.round(((index + 1) / Math.max(1, chunks.length)) * 100));
    }
    await prisma.document.update({ where: { id: document.id }, data: { status: 'READY', chunkCount: chunks.length } });
    return { chunks: chunks.length };
  } catch (error) {
    await prisma.document.update({ where: { id: document.id }, data: { status: 'FAILED', errorMessage: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown error' } });
    throw error;
  }
}

function csvCell(value: unknown) {
  const raw = value == null ? '' : String(value);
  return `"${raw.replaceAll('"', '""')}"`;
}

async function runExport(exportTaskId: string) {
  const task = await prisma.exportTask.findUnique({ where: { id: exportTaskId } });
  if (!task) throw new Error('Export task not found');
  await prisma.exportTask.update({ where: { id: task.id }, data: { status: 'PROCESSING', progress: 10 } });
  await mkdir(exportDir, { recursive: true });
  let rows: Array<Record<string, unknown>>;
  if (task.type === 'TRANSACTIONS') rows = (await prisma.transaction.findMany({ where: { wallet: { userId: task.userId } }, orderBy: { createdAt: 'desc' } })).map((row) => ({ ...row, amount: String(row.amount), balance: String(row.balance) }));
  else if (task.type === 'ORDERS') rows = (await prisma.order.findMany({ where: { userId: task.userId }, orderBy: { createdAt: 'desc' } })).map((row) => ({ ...row, amount: String(row.amount), paidAmount: row.paidAmount ? String(row.paidAmount) : null }));
  else rows = (await prisma.usageLog.findMany({ where: { userId: task.userId }, orderBy: { createdAt: 'desc' } })).map((row) => ({ ...row, cost: String(row.cost), metadata: JSON.stringify(row.metadata) }));
  const extension = task.format === 'JSON' ? 'json' : 'csv';
  const filePath = path.join(exportDir, `${task.id}.${extension}`);
  if (task.format === 'JSON') await writeFile(filePath, JSON.stringify(rows, null, 2));
  else {
    const headers = rows[0] ? Object.keys(rows[0]) : ['id'];
    await writeFile(filePath, [headers.map(csvCell).join(','), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(','))].join('\n'));
  }
  await prisma.exportTask.update({ where: { id: task.id }, data: { status: 'COMPLETED', progress: 100, fileUrl: filePath, expiresAt: new Date(Date.now() + 7 * 86400_000) } });
  return { rows: rows.length, filePath };
}

async function sendEmail(data: { to: string; subject: string; html: string }) {
  if (!process.env.RESEND_API_KEY) { logger.info({ to: data.to, subject: data.subject }, 'email skipped: RESEND_API_KEY is empty'); return { skipped: true }; }
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.EMAIL_FROM, ...data }) });
  if (!response.ok) throw new Error(`Email provider ${response.status}: ${await response.text()}`);
  return response.json();
}

async function deliverWebhook(deliveryId: string) {
  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { endpoint: true } });
  if (!delivery) throw new Error('Webhook delivery not found');
  const body = JSON.stringify(delivery.payload);
  const signature = createHmac('sha256', delivery.endpoint.secret).update(body).digest('hex');
  const response = await fetch(delivery.endpoint.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Token-Factory-Event': delivery.event, 'X-Token-Factory-Signature': `sha256=${signature}` }, body });
  await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { attempts: { increment: 1 }, status: response.ok ? 'DELIVERED' : 'RETRYING', response: `${response.status} ${(await response.text()).slice(0, 1000)}`, nextRetryAt: response.ok ? null : new Date(Date.now() + 60_000) } });
  if (!response.ok) throw new Error(`Webhook returned ${response.status}`);
}

async function createMonthlyInvoices() {
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const nextMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
  const organizations = await prisma.organization.findMany({ where: { status: 'ACTIVE' } });
  await mkdir(exportDir, { recursive: true });
  for (const organization of organizations) {
    const total = await prisma.usageLog.aggregate({ where: { organizationId: organization.id, createdAt: { gte: month, lt: nextMonth }, status: 'SUCCESS' }, _sum: { cost: true }, _count: true });
    const invoice = await prisma.monthlyInvoice.upsert({ where: { organizationId_month: { organizationId: organization.id, month } }, create: { organizationId: organization.id, month, amount: total._sum.cost || 0, lineItems: { requests: total._count }, status: 'ISSUED', issuedAt: new Date() }, update: { amount: total._sum.cost || 0, lineItems: { requests: total._count } } });
    const pdfPath = path.join(exportDir, `invoice-${invoice.id}.pdf`);
    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 56 });
      doc.pipe(createWriteStream(pdfPath)).on('finish', resolve).on('error', reject);
      doc.fontSize(24).text('Token Factory Invoice').moveDown();
      doc.fontSize(12).text(`Organization: ${organization.name}`).text(`Billing month: ${month.toISOString().slice(0, 7)}`).text(`Requests: ${total._count}`).text(`Amount due: $${Number(total._sum.cost || 0).toFixed(8)} USD`).moveDown().text(`Invoice ID: ${invoice.id}`);
      doc.end();
    });
    await prisma.monthlyInvoice.update({ where: { id: invoice.id }, data: { pdfUrl: pdfPath } });
  }
}

async function reconcile() {
  const expired = await prisma.reservation.findMany({ where: { status: 'PENDING', expiresAt: { lt: new Date() } }, take: 500 });
  for (const reservation of expired) {
    await prisma.$transaction(async (tx) => {
      const latest = await tx.reservation.findUnique({ where: { id: reservation.id } });
      if (latest?.status !== 'PENDING') return;
      if (latest.organizationId) await tx.organizationWallet.update({ where: { organizationId: latest.organizationId }, data: { frozen: { decrement: latest.amount } } });
      else await tx.wallet.update({ where: { userId: latest.userId }, data: { frozen: { decrement: latest.amount } } });
      await tx.reservation.update({ where: { id: latest.id }, data: { status: 'EXPIRED', settledAt: new Date() } });
    });
  }
  return { released: expired.length };
}

async function generateAlerts() {
  const failed = await prisma.usageLog.count({ where: { status: 'FAILED', createdAt: { gte: new Date(Date.now() - 15 * 60_000) } } });
  if (failed >= 10) await prisma.systemAlert.create({ data: { type: 'UPSTREAM_FAILURES', severity: failed >= 50 ? 'CRITICAL' : 'WARNING', title: 'High upstream failure rate', message: `${failed} failed requests in the last 15 minutes`, source: 'worker' } });
  const stuck = await prisma.document.count({ where: { status: 'PROCESSING', updatedAt: { lt: new Date(Date.now() - 30 * 60_000) } } });
  if (stuck) await prisma.systemAlert.create({ data: { type: 'STUCK_DOCUMENTS', severity: 'WARNING', title: 'Document processing is delayed', message: `${stuck} documents have been processing for more than 30 minutes`, source: 'worker' } });
}

async function cleanup() {
  const retention = Number(process.env.LOG_RETENTION_DAYS || 90);
  const cutoff = new Date(Date.now() - retention * 86400_000);
  const expiredExports = await prisma.exportTask.findMany({ where: { expiresAt: { lt: new Date() }, status: 'COMPLETED' } });
  for (const task of expiredExports) if (task.fileUrl) await unlink(task.fileUrl).catch(() => undefined);
  await prisma.exportTask.updateMany({ where: { id: { in: expiredExports.map((task) => task.id) } }, data: { status: 'EXPIRED', fileUrl: null } });
  if (enabled('ENABLE_LOG_CLEANUP', true)) {
    await prisma.moderationLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    await prisma.agentToolLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  }
}

async function evaluateKnowledge(runId: string) {
  const run = await prisma.knowledgeEvalRun.findUnique({ where: { id: runId }, include: { dataset: { include: { cases: true } } } });
  if (!run) throw new Error('Knowledge evaluation run not found');
  await prisma.knowledgeEvalRun.update({ where: { id: run.id }, data: { status: 'RUNNING', startedAt: new Date() } });
  for (const testCase of run.dataset.cases) await prisma.knowledgeEvalResult.upsert({ where: { runId_caseId: { runId: run.id, caseId: testCase.id } }, create: { runId: run.id, caseId: testCase.id, score: 0, metrics: { note: 'Queue an application-specific evaluator to populate this result.' } }, update: {} });
  await prisma.knowledgeEvalRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', completedAt: new Date(), metrics: { cases: run.dataset.cases.length } } });
}

async function evaluateAgent(runId: string) {
  const run = await prisma.agentEvalRun.findUnique({ where: { id: runId }, include: { dataset: { include: { cases: true } } } });
  if (!run) throw new Error('Agent evaluation run not found');
  await prisma.agentEvalRun.update({ where: { id: run.id }, data: { status: 'RUNNING', startedAt: new Date() } });
  for (const testCase of run.dataset.cases) await prisma.agentEvalResult.upsert({ where: { runId_caseId: { runId: run.id, caseId: testCase.id } }, create: { runId: run.id, caseId: testCase.id, score: 0, metrics: { note: 'Queue an application-specific evaluator to populate this result.' } }, update: {} });
  await prisma.agentEvalRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', completedAt: new Date(), metrics: { cases: run.dataset.cases.length } } });
}

const worker = new Worker('token-factory', async (job) => {
  logger.info({ jobId: job.id, name: job.name }, 'job started');
  switch (job.name) {
    case 'parse-document': return parseDocument(String(job.data.documentId), job);
    case 'export': return runExport(String(job.data.exportTaskId));
    case 'email': return sendEmail(job.data as { to: string; subject: string; html: string });
    case 'webhook': return deliverWebhook(String(job.data.deliveryId));
    case 'monthly-report': return createMonthlyInvoices();
    case 'reconcile': return reconcile();
    case 'alerts': return generateAlerts();
    case 'cleanup': return cleanup();
    case 'knowledge-eval': return evaluateKnowledge(String(job.data.runId));
    case 'agent-eval': return evaluateAgent(String(job.data.runId));
    default: throw new Error(`Unknown job: ${job.name}`);
  }
}, { connection: { url: redisUrl }, concurrency: 4 });

worker.on('completed', (job) => logger.info({ jobId: job.id, name: job.name }, 'job completed'));
worker.on('failed', (job, error) => logger.error({ jobId: job?.id, name: job?.name, error: error.message }, 'job failed'));
worker.on('error', (error) => logger.error({ error: error.message }, 'worker error'));

async function schedule() {
  if (!enabled('ENABLE_WORKER_CRON', true)) return;
  await queue.upsertJobScheduler('monthly-report', { pattern: '0 3 1 * *', tz: 'UTC' }, { name: 'monthly-report', data: {} });
  await queue.upsertJobScheduler('reconcile', { every: 5 * 60_000 }, { name: 'reconcile', data: {} });
  await queue.upsertJobScheduler('alerts', { every: 10 * 60_000 }, { name: 'alerts', data: {} });
  await queue.upsertJobScheduler('cleanup', { pattern: '0 4 * * *', tz: 'UTC' }, { name: 'cleanup', data: {} });
}

void schedule().then(() => logger.info('token-factory-worker ready')).catch((error) => logger.error({ error }, 'scheduler setup failed'));

async function shutdown() {
  await worker.close();
  await queue.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
