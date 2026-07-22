import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('demo123456', 12);
  const user = await prisma.user.upsert({
    where: { email: 'demo@token-factory.local' },
    update: {},
    create: {
      email: 'demo@token-factory.local',
      name: 'Demo User',
      passwordHash,
      wallet: { create: { balance: 10 } },
    },
  });

  const models = [
    {
      slug: 'gpt-4o-mini',
      name: 'GPT-4o mini',
      provider: 'openai-compatible',
      description: 'Fast, economical general-purpose chat model',
      contextWindow: 128000,
      inputPrice: 0.15,
      outputPrice: 0.6,
      capabilities: ['chat', 'stream', 'tools', 'vision'],
    },
    {
      slug: 'text-embedding-3-small',
      name: 'Text Embedding 3 Small',
      provider: 'openai-compatible',
      description: '1536-dimensional text embeddings',
      contextWindow: 8191,
      embeddingPrice: 0.02,
      capabilities: ['embedding'],
    },
  ];

  for (const model of models) {
    await prisma.model.upsert({
      where: { slug: model.slug },
      update: model,
      create: model,
    });
  }

  const channel = await prisma.channel.upsert({
    where: { id: 'default-openai-channel' },
    update: {
      name: process.env.OPENAI_API_KEY ? 'Default OpenAI' : 'Local demo channel',
      provider: process.env.OPENAI_API_KEY ? 'OPENAI' : 'MOCK',
      baseUrl: process.env.OPENAI_BASE_URL || 'mock://local',
      apiKeyEncrypted: process.env.OPENAI_API_KEY ? 'env:OPENAI_API_KEY' : 'mock',
    },
    create: {
      id: 'default-openai-channel',
      name: process.env.OPENAI_API_KEY ? 'Default OpenAI' : 'Local demo channel',
      provider: process.env.OPENAI_API_KEY ? 'OPENAI' : 'MOCK',
      baseUrl: process.env.OPENAI_BASE_URL || 'mock://local',
      apiKeyEncrypted: process.env.OPENAI_API_KEY ? 'env:OPENAI_API_KEY' : 'mock',
    },
  });

  for (const slug of ['gpt-4o-mini', 'text-embedding-3-small']) {
    const model = await prisma.model.findUniqueOrThrow({ where: { slug } });
    await prisma.channelModel.upsert({
      where: { channelId_modelId: { channelId: channel.id, modelId: model.id } },
      update: { upstreamModel: slug, enabled: true },
      create: { channelId: channel.id, modelId: model.id, upstreamModel: slug },
    });
  }

  await prisma.agentApp.upsert({
    where: { slug: 'research-assistant' },
    update: {},
    create: {
      userId: user.id,
      name: 'Research Assistant',
      slug: 'research-assistant',
      description: 'Answers questions with a concise research plan.',
      systemPrompt: 'You are a careful research assistant. Explain assumptions and cite available sources.',
      modelSlug: 'gpt-4o-mini',
      visibility: 'PUBLIC',
    },
  });

  await prisma.workflowTemplate.upsert({
    where: { slug: 'summarize-and-translate' },
    update: {},
    create: {
      name: 'Summarize and translate',
      slug: 'summarize-and-translate',
      category: 'Content',
      description: 'Summarize input and translate the result.',
      featured: true,
      definition: {
        nodes: [
          { id: 'summarize', type: 'llm', prompt: 'Summarize: {{input}}' },
          { id: 'translate', type: 'llm', prompt: 'Translate to Chinese: {{previous}}' },
        ],
      },
    },
  });

  console.log('Seed complete. Demo login: demo@token-factory.local / demo123456');
}

main().finally(() => prisma.$disconnect());
