import { describe, expect, it } from 'vitest';
import { calculateCost, estimateReservation, estimateTokens, messageTokens } from './billing.js';

describe('billing helpers', () => {
  it('estimates non-empty text', () => expect(estimateTokens('hello world')).toBeGreaterThan(0));
  it('adds message overhead', () => expect(messageTokens([{ content: 'hello' }])).toBeGreaterThan(estimateTokens('hello')));
  it('calculates per-million pricing', () => expect(calculateCost(1_000_000, 500_000, 1, 2)).toBe(2));
  it('never reserves zero', () => expect(estimateReservation(0, 0, 0, 0)).toBe(0.000001));
});
