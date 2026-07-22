export function estimateTokens(text: string) {
  if (!text) return 0;
  const ascii = (text.match(/[\x00-\x7F]/g) || []).length;
  return Math.max(1, Math.ceil(ascii / 4 + (text.length - ascii) / 1.5));
}

export function messageTokens(messages: Array<{ content?: unknown }>) {
  return messages.reduce((sum, message) => {
    const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '');
    return sum + estimateTokens(content) + 4;
  }, 2);
}

export function calculateCost(
  promptTokens: number,
  completionTokens: number,
  inputPricePerMillion: number,
  outputPricePerMillion: number,
  toolCost = 0,
) {
  return Number(((promptTokens * inputPricePerMillion + completionTokens * outputPricePerMillion) / 1_000_000 + toolCost).toFixed(8));
}

export function estimateReservation(
  promptTokens: number,
  maxCompletionTokens: number,
  inputPricePerMillion: number,
  outputPricePerMillion: number,
) {
  return Math.max(0.000001, calculateCost(promptTokens, maxCompletionTokens, inputPricePerMillion, outputPricePerMillion));
}
