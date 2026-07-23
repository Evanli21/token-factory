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
import { prisma } from '@szrouter/database';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const uploadDir = process.env.UPLOAD_DIR || './uploads';
const exportDir = process.env.EXPORT_DIR || './exports';
const queueName = 'szrouter';
const queue = new Queue(queueName, { connection: { url: redisUrl }, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2_000 }, removeOnComplete: 500, removeOnFail: 500 } });

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

async function completeText(options: { apiKey?: string; baseUrl?: string; model: string; messages: Array<{ role: string; content: string }> }) {
  if (!options.apiKey) return '';
  const baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: options.model, messages: options.messages, stream: false, temperature: 0 }),
  });
  if (!response.ok) throw new Error(`Evaluation upstream ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content || '';
}

function lexicalScore(expected: string, actual: string) {
  const expectedTerms = new Set(expected.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  if (!expectedTerms.size) return 0;
  const actualTerms = new Set(actual.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  return [...expectedTerms].filter((term) => actualTerms.has(term)).length / expectedTerms.size;
}

async function judge(expected: string | null, actual: string) {
  if (!expected) return { score: actual.trim() ? 1 : 0, method: 'non_empty' };
  if (enabled('ENABLE_LLM_EVAL') && (process.env.RAG_CHAT_API_KEY || process.env.OPENAI_API_KEY)) {
    const result = await completeText({
      apiKey: process.env.RAG_CHAT_API_KEY || process.env.OPENAI_API_KEY,
      baseUrl: process.env.RAG_CHAT_BASE_URL || process.env.OPENAI_BASE_URL,
      model: process.env.RAG_CHAT_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'system', content: 'Score the candidate answer against the reference from 0 to 1. Return JSON only: {"score":number,"reason":string}.' }, { role: 'user', content: `REFERENCE:\n${expected}\n\nCANDIDATE:\n${actual}` }],
    });
    try {
      const parsed = JSON.parse(result.replace(/^```json\s*|\s*```$/g, '')) as { score?: number; reason?: string };
      return { score: Math.min(1, Math.max(0, Number(parsed.score || 0))), method: 'llm_judge', reason: parsed.reason };
    } catch {
      return { score: lexicalScore(expected, actual), method: 'lexical_fallback' };
    }
  }
  return { score: lexicalScore(expected, actual), method: 'lexical' };
}

async function deliverWebhook(deliveryId: string) {
  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { endpoint: true } });
  if (!delivery) throw new Error('Webhook delivery not found');
  const body = JSON.stringify(delivery.payload);
  const signature = createHmac('sha256', delivery.endpoint.secret).update(body).digest('hex');
  const response = await fetch(delivery.endpoint.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SZRouter-Event': delivery.event, 'X-SZRouter-Signature': `sha256=${signature}` }, body });
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
      doc.fontSize(24).text('SZRouter Invoice').moveDown();
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
  let scoreSum = 0;
  for (const testCase of run.dataset.cases) {
    const response = await fetch(`${(process.env.INTERNAL_API_URL || 'http://gateway:8000').replace(/\/$/, '')}/internal/knowledge/search`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Token': process.env.INTERNAL_API_TOKEN || '' }, body: JSON.stringify({ knowledge_base_id: run.dataset.knowledgeBaseId, query: testCase.question, top_k: 6 }) });
    if (!response.ok) throw new Error(`Knowledge search ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const search = await response.json() as { data: Array<{ document_name: string; content: string; score: number }> };
    const sourceText = search.data.map((item, index) => `[${index + 1}] ${item.document_name}\n${item.content}`).join('\n\n');
    const answer = await completeText({ apiKey: process.env.RAG_CHAT_API_KEY || process.env.OPENAI_API_KEY, baseUrl: process.env.RAG_CHAT_BASE_URL || process.env.OPENAI_BASE_URL, model: process.env.RAG_CHAT_MODEL || 'gpt-4o-mini', messages: [{ role: 'system', content: `Answer using only these sources and cite them:\n${sourceText}` }, { role: 'user', content: testCase.question }] }) || search.data[0]?.content || 'No relevant source was found.';
    const assessment = await judge(testCase.expectedAnswer, answer);
    scoreSum += assessment.score;
    await prisma.knowledgeEvalResult.upsert({ where: { runId_caseId: { runId: run.id, caseId: testCase.id } }, create: { runId: run.id, caseId: testCase.id, answer, sources: search.data, score: assessment.score, metrics: assessment }, update: { answer, sources: search.data, score: assessment.score, metrics: assessment } });
  }
  await prisma.knowledgeEvalRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', completedAt: new Date(), metrics: { cases: run.dataset.cases.length, averageScore: run.dataset.cases.length ? scoreSum / run.dataset.cases.length : 0 } } });
}

async function evaluateAgent(runId: string) {
  const run = await prisma.agentEvalRun.findUnique({ where: { id: runId }, include: { dataset: { include: { cases: true, agentApp: true } } } });
  if (!run) throw new Error('Agent evaluation run not found');
  await prisma.agentEvalRun.update({ where: { id: run.id }, data: { status: 'RUNNING', startedAt: new Date() } });
  let scoreSum = 0;
  for (const testCase of run.dataset.cases) {
    const input = typeof testCase.input === 'string' ? testCase.input : JSON.stringify(testCase.input);
    const output = await completeText({ apiKey: process.env.AGENT_CHAT_API_KEY || process.env.OPENAI_API_KEY, baseUrl: process.env.AGENT_CHAT_BASE_URL || process.env.OPENAI_BASE_URL, model: process.env.AGENT_CHAT_MODEL || run.dataset.agentApp.modelSlug, messages: [{ role: 'system', content: run.dataset.agentApp.systemPrompt }, { role: 'user', content: input }] });
    const assessment = await judge(testCase.expectedOutput, output);
    scoreSum += assessment.score;
    await prisma.agentEvalResult.upsert({ where: { runId_caseId: { runId: run.id, caseId: testCase.id } }, create: { runId: run.id, caseId: testCase.id, output, toolCalls: [], score: assessment.score, metrics: assessment }, update: { output, toolCalls: [], score: assessment.score, metrics: assessment } });
  }
  await prisma.agentEvalRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', completedAt: new Date(), metrics: { cases: run.dataset.cases.length, averageScore: run.dataset.cases.length ? scoreSum / run.dataset.cases.length : 0 } } });
}

const worker = new Worker(queueName, async (job) => {
  logger.info({ jobId: job.id, name: job.name }, 'job started');
  switch (job.name) {
    case 'knowledge_parse':
    case 'parse-document': return parseDocument(String(job.data.documentId), job);
    case 'export_task':
    case 'export': return runExport(String(job.data.exportTaskId));
    case 'send_email':
    case 'email': return sendEmail(job.data as { to: string; subject: string; html: string });
    case 'webhook_retry':
    case 'webhook': return deliverWebhook(String(job.data.deliveryId));
    case 'monthly_billing':
    case 'monthly-report': return createMonthlyInvoices();
    case 'reconciliation':
    case 'reconcile': return reconcile();
    case 'alert_checks':
    case 'alerts': return generateAlerts();
    case 'log_cleanup':
    case 'cleanup': return cleanup();
    case 'knowledge_eval':
    case 'knowledge-eval': return evaluateKnowledge(String(job.data.runId));
    case 'agent_eval':
    case 'agent-eval': return evaluateAgent(String(job.data.runId));
    default: throw new Error(`Unknown job: ${job.name}`);
  }
}, { connection: { url: redisUrl }, concurrency: Math.max(1, Number(process.env.WORKER_CONCURRENCY || 1)) });

worker.on('active', (job) => {
  void prisma.backgroundJob.updateMany({
    where: job.data.backgroundJobId ? { id: String(job.data.backgroundJobId) } : { queueId: String(job.id) },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
  }).catch(() => undefined);
});
worker.on('progress', (job, progress) => {
  const value = typeof progress === 'number' ? Math.round(progress) : Number((progress as { value?: number })?.value || 0);
  void prisma.backgroundJob.updateMany({
    where: job.data.backgroundJobId ? { id: String(job.data.backgroundJobId) } : { queueId: String(job.id) },
    data: { progress: Math.min(100, Math.max(0, value)) },
  }).catch(() => undefined);
});
worker.on('completed', (job, result) => {
  logger.info({ jobId: job.id, name: job.name }, 'job completed');
  void prisma.backgroundJob.updateMany({
    where: job.data.backgroundJobId ? { id: String(job.data.backgroundJobId) } : { queueId: String(job.id) },
    data: { status: 'COMPLETED', progress: 100, result: result == null ? undefined : JSON.parse(JSON.stringify(result)), finishedAt: new Date(), error: null },
  }).catch(() => undefined);
});
worker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, name: job?.name, error: error.message }, 'job failed');
  if (job) void prisma.backgroundJob.updateMany({
    where: job.data.backgroundJobId ? { id: String(job.data.backgroundJobId) } : { queueId: String(job.id) },
    data: { status: 'FAILED', error: error.message.slice(0, 4000), finishedAt: new Date() },
  }).catch(() => undefined);
});
worker.on('error', (error) => logger.error({ error: error.message }, 'worker error'));

async function enqueueDatabaseJobs() {
  const pending = await prisma.backgroundJob.findMany({
    where: { status: 'PENDING', OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }] },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
  for (const item of pending) {
    const claimed = await prisma.backgroundJob.updateMany({ where: { id: item.id, status: 'PENDING' }, data: { status: 'QUEUING' } });
    if (!claimed.count) continue;
    try {
      const payload = item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload) ? item.payload as Record<string, unknown> : {};
      const queued = await queue.add(item.type, { ...payload, backgroundJobId: item.id }, { jobId: `db-${item.id}` });
      await prisma.backgroundJob.update({ where: { id: item.id }, data: { status: 'QUEUED', queueId: String(queued.id) } });
    } catch (error) {
      await prisma.backgroundJob.update({ where: { id: item.id }, data: { status: 'FAILED', error: error instanceof Error ? error.message.slice(0, 4000) : 'Queue failure', finishedAt: new Date() } });
    }
  }
  if (enabled('ENABLE_AUTO_EVAL')) {
    const [knowledgeRuns, agentRuns] = await Promise.all([
      prisma.knowledgeEvalRun.findMany({ where: { status: 'PENDING' }, take: 10 }),
      prisma.agentEvalRun.findMany({ where: { status: 'PENDING' }, take: 10 }),
    ]);
    for (const run of knowledgeRuns) {
      const claimed = await prisma.knowledgeEvalRun.updateMany({ where: { id: run.id, status: 'PENDING' }, data: { status: 'QUEUED' } });
      if (claimed.count) await queue.add('knowledge_eval', { runId: run.id }, { jobId: `knowledge-eval-${run.id}` });
    }
    for (const run of agentRuns) {
      const claimed = await prisma.agentEvalRun.updateMany({ where: { id: run.id, status: 'PENDING' }, data: { status: 'QUEUED' } });
      if (claimed.count) await queue.add('agent_eval', { runId: run.id }, { jobId: `agent-eval-${run.id}` });
    }
  }
  const deliveries = await prisma.webhookDelivery.findMany({
    where: {
      status: { in: ['PENDING', 'RETRYING'] },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
    },
    take: 50,
  });
  for (const delivery of deliveries) {
    const claimed = await prisma.webhookDelivery.updateMany({ where: { id: delivery.id, status: delivery.status }, data: { status: 'QUEUED' } });
    if (claimed.count) await queue.add('webhook_retry', { deliveryId: delivery.id }, { jobId: `webhook-${delivery.id}-${delivery.attempts}` });
  }
}

async function schedule() {
  if (!enabled('ENABLE_WORKER_CRON', true)) return;
  await queue.upsertJobScheduler('monthly_billing', { pattern: '0 3 1 * *', tz: 'UTC' }, { name: 'monthly_billing', data: {} });
  await queue.upsertJobScheduler('reconciliation', { every: 5 * 60_000 }, { name: 'reconciliation', data: {} });
  await queue.upsertJobScheduler('alert_checks', { every: 10 * 60_000 }, { name: 'alert_checks', data: {} });
  await queue.upsertJobScheduler('log_cleanup', { pattern: '0 4 * * *', tz: 'UTC' }, { name: 'log_cleanup', data: {} });
}

const databasePoller = setInterval(() => void enqueueDatabaseJobs().catch((error) => logger.error({ error }, 'background job poll failed')), 5_000);
databasePoller.unref();
void Promise.all([schedule(), enqueueDatabaseJobs()]).then(() => logger.info('szrouter-worker ready')).catch((error) => logger.error({ error }, 'scheduler setup failed'));

async function shutdown() {
  clearInterval(databasePoller);
  await worker.close();
  await queue.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
