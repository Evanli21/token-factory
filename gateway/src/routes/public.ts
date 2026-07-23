import { Router } from 'express';
import { prisma } from '@szrouter/database';

export const publicRouter = Router();

publicRouter.get('/models', async (_req, res) => {
  const models = await prisma.model.findMany({
    where: { enabled: true },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      slug: true,
      name: true,
      provider: true,
      description: true,
      contextWindow: true,
      inputPrice: true,
      outputPrice: true,
      embeddingPrice: true,
      capabilities: true,
      channelModels: { where: { enabled: true }, select: { inputPrice: true, outputPrice: true } },
    },
  });
  const data = models.map(({ channelModels, ...model }) => ({
    ...model,
    inputCost: channelModels.map((item) => item.inputPrice).filter((value) => value != null).sort((a, b) => Number(a) - Number(b))[0] || 0,
    outputCost: channelModels.map((item) => item.outputPrice).filter((value) => value != null).sort((a, b) => Number(a) - Number(b))[0] || 0,
  }));
  res.json({ data });
});

publicRouter.get('/agent-apps', async (_req, res) => {
  const data = await prisma.agentApp.findMany({
    where: { visibility: 'PUBLIC', status: 'ACTIVE' },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      avatarUrl: true,
      modelSlug: true,
      pricePerRun: true,
    },
  });
  res.json({ data });
});

publicRouter.get('/agent-apps/:id', async (req, res) => {
  const app = await prisma.agentApp.findFirst({
    where: { OR: [{ id: req.params.id }, { slug: req.params.id }], visibility: 'PUBLIC', status: 'ACTIVE' },
    select: { id: true, slug: true, name: true, description: true, avatarUrl: true, modelSlug: true, pricePerRun: true, visibility: true, status: true },
  });
  if (!app) return res.status(404).json({ error: { message: 'Published agent app not found' } });
  res.json({ data: [app] });
});

publicRouter.get('/workflow-templates', async (_req, res) => {
  const data = await prisma.workflowTemplate.findMany({
    orderBy: [{ featured: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      category: true,
      featured: true,
    },
  });
  res.json({ data });
});

publicRouter.get('/workflows/:id', async (req, res) => {
  const workflow = await prisma.agentWorkflow.findFirst({
    where: { OR: [{ id: req.params.id }, { slug: req.params.id }], status: 'ACTIVE' },
    select: { id: true, slug: true, name: true, description: true, definition: true, version: true, updatedAt: true },
  });
  if (!workflow) return res.status(404).json({ error: { message: 'Published workflow not found' } });
  res.json(workflow);
});
