import { Router } from 'express';
import { z } from 'zod';
import { internalAuth } from '../middleware/auth.js';
import { hybridRetrieve } from '../services/rag.js';

export const internalRouter = Router();
internalRouter.use(internalAuth);

internalRouter.post('/knowledge/search', async (req, res, next) => {
  try {
    const input = z.object({
      knowledge_base_id: z.string().min(1),
      query: z.string().min(1).max(20_000),
      top_k: z.number().int().min(1).max(50).default(6),
    }).parse(req.body);
    const results = await hybridRetrieve(input.knowledge_base_id, input.query, input.top_k);
    res.json({
      data: results.map((item) => ({
        id: item.id,
        document_id: item.documentId,
        document_name: item.documentName,
        content: item.content,
        score: item.score,
      })),
    });
  } catch (error) {
    next(error);
  }
});
