import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { prisma, type AgentTool, type Model } from '@szrouter/database';
import { z } from 'zod';
import { apiKeyAuth } from '../middleware/auth.js';
import { calculateCost, estimateReservation, estimateTokens, messageTokens } from '../lib/billing.js';
import { reserveBalance, settleBalance } from '../services/billing.js';
import { channelCandidates, completeChat, createEmbedding, findModel, streamChat, type ChatRequest } from '../services/provider.js';
import { moderate } from '../services/moderation.js';
import { citationPrompt, hybridRetrieve } from '../services/rag.js';

export const v1Router = Router();
v1Router.use(apiKeyAuth);

const messageSchema = z.object({ role: z.enum(['system', 'user', 'assistant', 'tool']), content: z.unknown(), name: z.string().optional(), tool_call_id: z.string().optional() });
const chatSchema = z.object({
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  stream: z.boolean().default(false),
  max_tokens: z.number().int().positive().max(128_000).optional(),
  max_completion_tokens: z.number().int().positive().max(128_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  tools: z.array(z.unknown()).optional(),
  tool_choice: z.unknown().optional(),
}).passthrough();

function contentText(body: ChatRequest) {
  return body.messages.map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '')).join('\n');
}

function parseUsage(data: Record<string, unknown>, body: ChatRequest) {
  const usage = (data.usage || {}) as Record<string, unknown>;
  const choices = Array.isArray(data.choices) ? data.choices as Array<Record<string, unknown>> : [];
  const message = (choices[0]?.message || {}) as Record<string, unknown>;
  const content = typeof message.content === 'string' ? message.content : '';
  return {
    promptTokens: Number(usage.prompt_tokens || messageTokens(body.messages)),
    completionTokens: Number(usage.completion_tokens || estimateTokens(content)),
    toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls as Array<Record<string, unknown>> : [],
    outputText: content,
  };
}

async function executeBilledChat(
  req: Request,
  body: ChatRequest,
  endpoint: string,
  options: { baseCost?: number; tools?: AgentTool[] } = {},
) {
  const requestId = req.requestId || randomUUID();
  const model = await findModel(body.model);
  if (!model) throw new Error(`Model '${body.model}' is not available`);
  const moderation = await moderate(contentText(body), req.auth!.user.id, requestId);
  if (!moderation.allowed) throw new Error(`Content blocked by moderation rule: ${moderation.rule}`);
  const candidates = await channelCandidates(model.id);
  if (!candidates.length) throw new Error('No healthy channel is available');

  const promptTokens = messageTokens(body.messages);
  const maxTokens = body.max_completion_tokens || body.max_tokens || Math.min(2048, model.contextWindow - promptTokens);
  const possibleToolCost = (options.tools || []).reduce((sum, tool) => sum + Number(tool.price), 0);
  const reserved = estimateReservation(promptTokens, maxTokens, Number(model.inputPrice), Number(model.outputPrice)) + (options.baseCost || 0) + possibleToolCost;
  await reserveBalance(req.auth!, model, requestId, reserved);
  const started = Date.now();

  try {
    const result = await completeChat(body, candidates);
    const usage = parseUsage(result.data, body);
    const outputModeration = await moderate(usage.outputText, req.auth!.user.id, requestId);
    if (!outputModeration.allowed) throw new Error(`Output blocked by moderation rule: ${outputModeration.rule}`);
    const toolByName = new Map((options.tools || []).map((tool) => [tool.slug, tool]));
    let toolCost = 0;
    const calledTools: AgentTool[] = [];
    for (const call of usage.toolCalls) {
      const fn = (call.function || {}) as Record<string, unknown>;
      const tool = toolByName.get(String(fn.name || ''));
      if (tool) { calledTools.push(tool); toolCost += Number(tool.price); }
    }
    const cost = calculateCost(usage.promptTokens, usage.completionTokens, Number(model.inputPrice), Number(model.outputPrice), toolCost + (options.baseCost || 0));
    await settleBalance(requestId, cost, true);
    const log = await prisma.usageLog.create({ data: { userId: req.auth!.user.id, apiKeyId: req.auth!.apiKey?.id, organizationId: req.auth!.organizationId, modelId: model.id, channelId: result.selection.channelId, requestId, endpoint, status: 'SUCCESS', promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, toolCalls: usage.toolCalls.length, cost, latencyMs: Date.now() - started } });
    for (const tool of calledTools) await prisma.agentToolLog.create({ data: { toolId: tool.id, usageLogId: log.id, status: 'REQUESTED', cost: tool.price } });
    return { data: result.data, usage, cost, requestId };
  } catch (error) {
    await settleBalance(requestId, 0, false);
    await prisma.usageLog.create({ data: { userId: req.auth!.user.id, apiKeyId: req.auth!.apiKey?.id, organizationId: req.auth!.organizationId, modelId: model.id, requestId, endpoint, status: 'FAILED', latencyMs: Date.now() - started, errorCode: error instanceof Error ? error.message.slice(0, 180) : 'UNKNOWN' } });
    throw error;
  }
}

v1Router.get('/models', async (_req, res) => {
  const models = await prisma.model.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } });
  res.json({ object: 'list', data: models.map((model) => ({ id: model.slug, object: 'model', created: Math.floor(model.createdAt.getTime() / 1000), owned_by: model.provider, name: model.name, description: model.description, pricing: { input: model.inputPrice, output: model.outputPrice, embedding: model.embeddingPrice }, context_window: model.contextWindow, capabilities: model.capabilities })) });
});

v1Router.post('/chat/completions', async (req, res, next) => {
  let requestId = req.requestId || randomUUID();
  try {
    const body = chatSchema.parse(req.body) as ChatRequest;
    if (!body.stream) {
      const result = await executeBilledChat(req, body, '/v1/chat/completions');
      res.setHeader('X-Request-Id', result.requestId);
      return res.json(result.data);
    }

    const model = await findModel(body.model);
    if (!model) return res.status(404).json({ error: { message: `Model '${body.model}' is not available`, type: 'invalid_request_error' } });
    const moderation = await moderate(contentText(body), req.auth!.user.id, requestId);
    if (!moderation.allowed) return res.status(400).json({ error: { message: `Content blocked by moderation rule: ${moderation.rule}`, type: 'content_policy_error' } });
    const candidates = await channelCandidates(model.id);
    if (!candidates.length) return res.status(503).json({ error: { message: 'No healthy channel is available', type: 'upstream_error' } });
    const promptTokens = messageTokens(body.messages);
    const reserved = estimateReservation(promptTokens, body.max_completion_tokens || body.max_tokens || 2048, Number(model.inputPrice), Number(model.outputPrice));
    await reserveBalance(req.auth!, model, requestId, reserved);

    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Request-Id': requestId });
    res.flushHeaders();
    const controller = new AbortController();
    req.once('aborted', () => controller.abort());
    const started = Date.now();
    let completion = '';
    let upstreamUsage: Record<string, unknown> | undefined;
    try {
      await streamChat(body, candidates[0]!, controller.signal, (event) => {
        const choices = event.choices as Array<{ delta?: { content?: string } }> | undefined;
        if (choices?.[0]?.delta?.content) completion += choices[0].delta.content;
        if (event.usage) upstreamUsage = event.usage as Record<string, unknown>;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });
      const completionTokens = Number(upstreamUsage?.completion_tokens || estimateTokens(completion));
      const actualPrompt = Number(upstreamUsage?.prompt_tokens || promptTokens);
      const outputModeration = await moderate(completion, req.auth!.user.id, requestId);
      if (!outputModeration.allowed) throw new Error(`Output blocked by moderation rule: ${outputModeration.rule}`);
      const cost = calculateCost(actualPrompt, completionTokens, Number(model.inputPrice), Number(model.outputPrice));
      await settleBalance(requestId, cost, true);
      await prisma.usageLog.create({ data: { userId: req.auth!.user.id, apiKeyId: req.auth!.apiKey?.id, organizationId: req.auth!.organizationId, modelId: model.id, channelId: candidates[0]!.channelId, requestId, endpoint: '/v1/chat/completions', status: 'SUCCESS', promptTokens: actualPrompt, completionTokens, cost, latencyMs: Date.now() - started } });
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error) {
      await settleBalance(requestId, 0, false);
      await prisma.usageLog.create({ data: { userId: req.auth!.user.id, apiKeyId: req.auth!.apiKey?.id, organizationId: req.auth!.organizationId, modelId: model.id, channelId: candidates[0]!.channelId, requestId, endpoint: '/v1/chat/completions', status: 'FAILED', errorCode: error instanceof Error ? error.message.slice(0, 180) : 'UNKNOWN', latencyMs: Date.now() - started } });
      res.write(`data: ${JSON.stringify({ error: { message: error instanceof Error ? error.message : 'Stream failed', type: 'upstream_error' } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (error) { next(error); }
});

v1Router.post('/embeddings', async (req, res, next) => {
  const requestId = req.requestId || randomUUID();
  try {
    const input = z.object({ model: z.string(), input: z.union([z.string(), z.array(z.string()).min(1).max(100)]) }).parse(req.body);
    const values = Array.isArray(input.input) ? input.input : [input.input];
    const model = await findModel(input.model);
    if (!model) return res.status(404).json({ error: { message: `Model '${input.model}' is not available` } });
    const candidates = await channelCandidates(model.id);
    if (!candidates.length) return res.status(503).json({ error: { message: 'No healthy channel is available' } });
    const tokens = values.reduce((sum, value) => sum + estimateTokens(value), 0);
    const estimatedCost = Math.max(0.000001, tokens * Number(model.embeddingPrice) / 1_000_000);
    await reserveBalance(req.auth!, model, requestId, estimatedCost);
    const results = [];
    let selection = candidates[0]!;
    for (let index = 0; index < values.length; index++) {
      const result = await createEmbedding(values[index]!, candidates);
      selection = result.selection;
      results.push({ object: 'embedding', index, embedding: result.embedding });
    }
    const cost = Number((tokens * Number(model.embeddingPrice) / 1_000_000).toFixed(8));
    await settleBalance(requestId, cost, true);
    await prisma.usageLog.create({ data: { userId: req.auth!.user.id, apiKeyId: req.auth!.apiKey?.id, organizationId: req.auth!.organizationId, modelId: model.id, channelId: selection.channelId, requestId, endpoint: '/v1/embeddings', status: 'SUCCESS', promptTokens: tokens, cost } });
    res.json({ object: 'list', data: results, model: model.slug, usage: { prompt_tokens: tokens, total_tokens: tokens } });
  } catch (error) {
    await settleBalance(requestId, 0, false).catch(() => undefined);
    next(error);
  }
});

v1Router.post('/agent/chat', async (req, res, next) => {
  try {
    const input = z.object({ agent_id: z.string(), messages: z.array(messageSchema).min(1), stream: z.boolean().default(false) }).parse(req.body);
    const agent = await prisma.agentApp.findFirst({ where: { OR: [{ id: input.agent_id }, { slug: input.agent_id }], status: 'ACTIVE' }, include: { tools: true } });
    if (!agent) return res.status(404).json({ error: { message: 'Agent app not found' } });
    const tools = agent.tools.map((tool) => ({ type: 'function', function: { name: tool.slug, description: tool.description, parameters: tool.schema } }));
    const agentMessages = input.messages.map((message) => ({ role: message.role, content: message.content ?? '', name: message.name, tool_call_id: message.tool_call_id }));
    const result = await executeBilledChat(req, { model: agent.modelSlug, messages: [{ role: 'system', content: agent.systemPrompt }, ...agentMessages], stream: false, tools }, '/v1/agent/chat', { baseCost: Number(agent.pricePerRun), tools: agent.tools });
    res.json({ ...result.data, agent: { id: agent.id, name: agent.name }, billing: { cost: result.cost } });
  } catch (error) { next(error); }
});

v1Router.post('/agent/apps/:id/chat', async (req, res, next) => {
  try {
    const input = z.object({ messages: z.array(messageSchema).min(1), stream: z.boolean().default(false) }).parse(req.body);
    const agent = await prisma.agentApp.findFirst({
      where: {
        status: 'ACTIVE',
        AND: [
          { OR: [{ id: req.params.id }, { slug: req.params.id }] },
          { OR: [
            { visibility: 'PUBLIC' },
            { userId: req.auth!.user.id },
            ...(req.auth!.organizationId ? [{ organizationId: req.auth!.organizationId }] : []),
          ] },
        ],
      },
      include: { tools: true },
    });
    if (!agent) return res.status(404).json({ error: { message: 'Agent app not found' } });
    const tools = agent.tools.map((tool) => ({ type: 'function', function: { name: tool.slug, description: tool.description, parameters: tool.schema } }));
    const messages = input.messages.map((message) => ({ role: message.role, content: message.content ?? '', name: message.name, tool_call_id: message.tool_call_id }));
    const result = await executeBilledChat(req, { model: agent.modelSlug, messages: [{ role: 'system', content: agent.systemPrompt }, ...messages], stream: false, tools }, '/v1/agent/apps/:id/chat', { baseCost: Number(agent.pricePerRun), tools: agent.tools });
    res.json({ ...result.data, agent: { id: agent.id, slug: agent.slug, name: agent.name }, billing: { cost: result.cost } });
  } catch (error) { next(error); }
});

v1Router.post('/knowledge/:id/ask', async (req, res, next) => {
  try {
    const input = z.object({ question: z.string().min(1).max(20_000), top_k: z.number().int().min(1).max(20).default(6), model: z.string().default(process.env.RAG_CHAT_MODEL || 'gpt-4o-mini') }).parse(req.body);
    const kb = await prisma.knowledgeBase.findFirst({ where: { id: req.params.id, OR: [{ userId: req.auth!.user.id }, { organizationId: req.auth!.organizationId || '__none__' }] } });
    if (!kb) return res.status(404).json({ error: { message: 'Knowledge base not found' } });
    const citations = await hybridRetrieve(kb.id, input.question, input.top_k);
    const result = await executeBilledChat(req, { model: input.model, messages: [{ role: 'system', content: `Answer only from the supplied sources. Cite sources as [1], [2], etc. If evidence is missing, say so.\n\n${citationPrompt(citations)}` }, { role: 'user', content: input.question }], stream: false }, '/v1/knowledge/:id/ask');
    const choices = result.data.choices as Array<{ message?: { content?: string } }> | undefined;
    res.json({ answer: choices?.[0]?.message?.content || '', citations: citations.map((citation, index) => ({ index: index + 1, document_id: citation.documentId, document_name: citation.documentName, chunk_id: citation.id, score: citation.score, excerpt: citation.content.slice(0, 500) })), usage: result.data.usage, cost: result.cost });
  } catch (error) { next(error); }
});

v1Router.post('/workflows/:id/run', async (req, res, next) => {
  try {
    const input = z.object({ input: z.unknown(), model: z.string().default('gpt-4o-mini') }).parse(req.body);
    const workflow = await prisma.agentWorkflow.findFirst({ where: { AND: [{ OR: [{ id: req.params.id }, { slug: req.params.id }] }, { OR: [{ userId: req.auth!.user.id }, { status: 'ACTIVE' }] }] } });
    if (!workflow) return res.status(404).json({ error: { message: 'Workflow not found' } });
    const definition = workflow.definition as { nodes?: Array<{ id?: string; type?: string; prompt?: string; condition?: string; onTrue?: string; onFalse?: string }> };
    const nodes = definition.nodes || [];
    let previous = typeof input.input === 'string' ? input.input : JSON.stringify(input.input);
    const trace = [];
    const nodeIndexes = new Map(nodes.map((node, index) => [node.id, index]));
    let index = 0;
    let steps = 0;
    while (index < nodes.length && steps < Math.max(10, nodes.length * 3)) {
      const node = nodes[index]!;
      steps += 1;
      if (node.type === 'condition') {
        const expression = node.condition || '';
        const lengthRule = expression.match(/(?:previous|input)\.length\s*(>=|<=|>|<|==)\s*(\d+)/i);
        const includesRule = expression.match(/(?:previous|input)\.includes\(['"](.+?)['"]\)/i);
        let passed = false;
        if (lengthRule) {
          const target = Number(lengthRule[2]);
          passed = lengthRule[1] === '>' ? previous.length > target : lengthRule[1] === '<' ? previous.length < target : lengthRule[1] === '>=' ? previous.length >= target : lengthRule[1] === '<=' ? previous.length <= target : previous.length === target;
        } else if (includesRule) passed = previous.includes(includesRule[1]!);
        else passed = Boolean(previous.trim());
        const nextId = passed ? node.onTrue : node.onFalse;
        trace.push({ node: node.id, type: 'condition', status: 'completed', passed, next: nextId || null });
        index = nextId ? (nodeIndexes.get(nextId) ?? nodes.length) : index + 1;
        continue;
      }
      if (node.type !== 'llm') {
        trace.push({ node: node.id, type: node.type, status: 'completed', output: previous });
        index += 1;
        continue;
      }
      const prompt = (node.prompt || '{{input}}').replaceAll('{{input}}', typeof input.input === 'string' ? input.input : JSON.stringify(input.input)).replaceAll('{{previous}}', previous);
      const result = await executeBilledChat(req, { model: input.model, messages: [{ role: 'user', content: prompt }], stream: false }, '/v1/workflows/:id/run');
      const choices = result.data.choices as Array<{ message?: { content?: string } }> | undefined;
      previous = choices?.[0]?.message?.content || '';
      trace.push({ node: node.id, status: 'completed', output: previous, cost: result.cost });
      index += 1;
    }
    res.json({ workflow_id: workflow.id, version: workflow.version, output: previous, trace, steps });
  } catch (error) { next(error); }
});
