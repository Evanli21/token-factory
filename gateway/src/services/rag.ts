import { prisma } from '@token-factory/database';
import { channelCandidates, createEmbedding, findModel } from './provider.js';

export type Citation = {
  id: string;
  documentId: string;
  documentName: string;
  content: string;
  score: number;
  metadata: unknown;
};

export async function hybridRetrieve(knowledgeBaseId: string, question: string, topK = 6) {
  const embeddingModel = await findModel(process.env.EMBEDDING_MODEL || 'text-embedding-3-small');
  if (!embeddingModel) throw new Error('Embedding model is not configured');
  const candidates = await channelCandidates(embeddingModel.id);
  if (!candidates.length) throw new Error('No embedding channel is available');
  const { embedding } = await createEmbedding(question, candidates);
  const vector = `[${embedding.map((value) => Number(value).toFixed(8)).join(',')}]`;

  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    documentId: string;
    documentName: string;
    content: string;
    metadata: unknown;
    vectorScore: number;
    lexicalScore: number;
  }>>(
    `SELECT c.id, c."documentId", d.name AS "documentName", c.content, c.metadata,
      (1 - (c.embedding <=> $1::vector))::float AS "vectorScore",
      ts_rank_cd(to_tsvector('simple', c.content), plainto_tsquery('simple', $3))::float AS "lexicalScore"
     FROM "DocumentChunk" c
     JOIN "Document" d ON d.id = c."documentId"
     WHERE d."knowledgeBaseId" = $2 AND c.embedding IS NOT NULL
     ORDER BY ((1 - (c.embedding <=> $1::vector)) * 0.75 +
       ts_rank_cd(to_tsvector('simple', c.content), plainto_tsquery('simple', $3)) * 0.25) DESC
     LIMIT $4`,
    vector, knowledgeBaseId, question, Math.min(20, Math.max(1, topK * 2)),
  );

  const terms = new Set(question.toLocaleLowerCase().split(/\s+/).filter((term) => term.length > 1));
  return rows
    .map((row) => {
      const haystack = row.content.toLocaleLowerCase();
      const rerank = [...terms].reduce((score, term) => score + (haystack.includes(term) ? 0.02 : 0), 0);
      return {
        id: row.id,
        documentId: row.documentId,
        documentName: row.documentName,
        content: row.content,
        metadata: row.metadata,
        score: Math.min(1, row.vectorScore * 0.75 + row.lexicalScore * 0.25 + rerank),
      } satisfies Citation;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function citationPrompt(citations: Citation[]) {
  if (!citations.length) return 'No relevant source passages were found.';
  return citations.map((citation, index) => `[${index + 1}] ${citation.documentName}\n${citation.content}`).join('\n\n');
}
