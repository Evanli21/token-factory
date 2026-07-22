import { createHash, randomUUID } from 'node:crypto';
import { prisma, type Channel, type ChannelModel, type Model } from '@token-factory/database';
import { config } from '../config.js';
import { channelFailed, channelSucceeded, circuitOpen } from '../lib/redis.js';
import { estimateTokens, messageTokens } from '../lib/billing.js';

export type ChatMessage = { role: string; content: unknown; name?: string; tool_call_id?: string };
export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  tools?: unknown[];
  tool_choice?: unknown;
  [key: string]: unknown;
};

export type Selection = ChannelModel & { channel: Channel; model: Model };

function channelSecret(channel: Channel) {
  if (channel.apiKeyEncrypted === 'env:OPENAI_API_KEY') return config.OPENAI_API_KEY;
  if (channel.apiKeyEncrypted.startsWith('env:')) return process.env[channel.apiKeyEncrypted.slice(4)] || '';
  return channel.apiKeyEncrypted;
}

export async function findModel(slug: string) {
  return prisma.model.findFirst({ where: { slug, enabled: true } });
}

export async function channelCandidates(modelId: string) {
  const rows = await prisma.channelModel.findMany({
    where: { modelId, enabled: true, channel: { status: 'ACTIVE' } },
    include: { channel: true, model: true },
    orderBy: [{ priority: 'asc' }, { channel: { priority: 'asc' } }],
  });
  const available: Selection[] = [];
  for (const row of rows) if (!(await circuitOpen(row.channelId))) available.push(row);
  return available.sort((a, b) => {
    const priority = (a.priority + a.channel.priority) - (b.priority + b.channel.priority);
    return priority || Math.random() * (b.weight + b.channel.weight) - Math.random() * (a.weight + a.channel.weight);
  });
}

function mockText(messages: ChatMessage[]) {
  const last = [...messages].reverse().find((message) => message.role === 'user');
  const input = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '');
  return `Token Factory 本地演示模型已收到：${input}\n\n配置 OPENAI_API_KEY 并重新运行种子命令后，即可切换到真实的 OpenAI Compatible 上游。`;
}

function mockCompletion(body: ChatRequest, model: string) {
  const content = mockText(body.messages);
  const promptTokens = messageTokens(body.messages);
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: promptTokens, completion_tokens: estimateTokens(content), total_tokens: promptTokens + estimateTokens(content) },
  };
}

async function upstreamFetch(selection: Selection, path: string, body: unknown, signal?: AbortSignal) {
  const url = `${selection.channel.baseUrl.replace(/\/$/, '')}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), selection.channel.timeoutMs);
  const linkedAbort = () => controller.abort();
  signal?.addEventListener('abort', linkedAbort, { once: true });
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${channelSecret(selection.channel)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Upstream ${response.status}: ${(await response.text()).slice(0, 500)}`);
    return response;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', linkedAbort);
  }
}

export async function completeChat(body: ChatRequest, candidates: Selection[]) {
  let lastError: unknown;
  for (const selection of candidates) {
    try {
      if (selection.channel.provider === 'MOCK' || selection.channel.baseUrl.startsWith('mock://')) {
        await channelSucceeded(selection.channelId);
        return { data: mockCompletion(body, selection.model.slug), selection };
      }
      const response = await upstreamFetch(selection, '/chat/completions', { ...body, model: selection.upstreamModel, stream: false });
      const data = await response.json();
      await channelSucceeded(selection.channelId);
      return { data: data as Record<string, unknown>, selection };
    } catch (error) {
      lastError = error;
      await channelFailed(selection.channelId);
    }
  }
  throw lastError || new Error('No healthy channel is available');
}

export async function streamChat(
  body: ChatRequest,
  selection: Selection,
  signal: AbortSignal,
  onEvent: (event: Record<string, unknown>) => void,
) {
  if (selection.channel.provider === 'MOCK' || selection.channel.baseUrl.startsWith('mock://')) {
    const id = `chatcmpl-${randomUUID()}`;
    const words = mockText(body.messages).split(/(\s+)/).filter(Boolean);
    for (const word of words) {
      if (signal.aborted) break;
      onEvent({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: selection.model.slug, choices: [{ index: 0, delta: { content: word }, finish_reason: null }] });
    }
    onEvent({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: selection.model.slug, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    await channelSucceeded(selection.channelId);
    return;
  }

  try {
    const response = await upstreamFetch(selection, '/chat/completions', { ...body, model: selection.upstreamModel, stream: true, stream_options: { include_usage: true } }, signal);
    if (!response.body) throw new Error('Upstream did not return a response body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      for (const line of lines) {
        const data = line.startsWith('data:') ? line.slice(5).trim() : '';
        if (!data || data === '[DONE]') continue;
        try { onEvent(JSON.parse(data) as Record<string, unknown>); } catch { /* ignore malformed keepalive lines */ }
      }
    }
    await channelSucceeded(selection.channelId);
  } catch (error) {
    await channelFailed(selection.channelId);
    throw error;
  }
}

function mockEmbedding(text: string) {
  const digest = createHash('sha256').update(text).digest();
  const values = Array.from({ length: 1536 }, (_, index) => (digest[index % digest.length]! / 255) * 2 - 1);
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / norm);
}

export async function createEmbedding(input: string, candidates: Selection[]) {
  let lastError: unknown;
  for (const selection of candidates) {
    try {
      if (selection.channel.provider === 'MOCK' || selection.channel.baseUrl.startsWith('mock://')) {
        return { embedding: mockEmbedding(input), selection, usage: { prompt_tokens: estimateTokens(input), total_tokens: estimateTokens(input) } };
      }
      const response = await upstreamFetch(selection, '/embeddings', { model: selection.upstreamModel, input });
      const data = await response.json() as { data?: Array<{ embedding: number[] }>; usage?: { prompt_tokens?: number; total_tokens?: number } };
      if (!data.data?.[0]?.embedding) throw new Error('Upstream returned no embedding');
      await channelSucceeded(selection.channelId);
      return { embedding: data.data[0].embedding, selection, usage: data.usage };
    } catch (error) {
      lastError = error;
      await channelFailed(selection.channelId);
    }
  }
  throw lastError || new Error('No healthy embedding channel is available');
}
