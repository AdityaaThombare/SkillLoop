import { describe, it, expect } from 'vitest';
import { softmax, entropy, margin, argmax } from '../src/decision/scoring.js';

describe('Scoring Utilities', () => {
  describe('softmax', () => {
    it('computes uniform probabilities for identical scores', () => {
      const result = softmax([0, 0, 0]);
      expect(result[0]).toBeCloseTo(0.3333, 4);
      expect(result[1]).toBeCloseTo(0.3333, 4);
      expect(result[2]).toBeCloseTo(0.3333, 4);
    });

    it('maintains numerical stability with large numbers', () => {
      const result = softmax([1000, 1000, 1000]);
      expect(result[0]).toBeCloseTo(0.3333, 4);
    });

    it('favors extremely high differences', () => {
      const result = softmax([100, 0, 0]);
      expect(result[0]).toBeCloseTo(1.0, 4);
      expect(result[1]).toBeCloseTo(0.0, 4);
      expect(result[2]).toBeCloseTo(0.0, 4);
    });

    it('handles negative numbers', () => {
      const result = softmax([-100, -100, 0]);
      expect(result[0]).toBeCloseTo(0.0, 4);
      expect(result[1]).toBeCloseTo(0.0, 4);
      expect(result[2]).toBeCloseTo(1.0, 4);
    });

    it('returns empty array for empty input', () => {
      expect(softmax([])).toEqual([]);
    });
  });

  describe('entropy', () => {
    it('returns 0 for a completely certain distribution', () => {
      expect(entropy([1, 0, 0])).toBeCloseTo(0, 4);
    });

    it('returns 1.0 for a completely uniform distribution', () => {
      expect(entropy([0.5, 0.5])).toBeCloseTo(1.0, 4);
      expect(entropy([0.3333, 0.3333, 0.3333])).toBeCloseTo(1.0, 4);
    });

    it('returns 0 for arrays of size 0 or 1', () => {
      expect(entropy([1])).toBe(0);
      expect(entropy([])).toBe(0);
    });
  });

  describe('margin', () => {
    it('computes difference between top two probabilities', () => {
      expect(margin([0.9, 0.05, 0.05])).toBeCloseTo(0.85, 4);
      expect(margin([0.6, 0.4])).toBeCloseTo(0.2, 4);
      expect(margin([0.1, 0.8, 0.1])).toBeCloseTo(0.7, 4);
    });

    it('returns 0 if fewer than 2 elements', () => {
      expect(margin([1])).toBe(0);
      expect(margin([])).toBe(0);
    });
  });

  describe('argmax', () => {
    it('returns index of max element', () => {
      expect(argmax([1, 5, 2])).toBe(1);
      expect(argmax([10, -5, 2])).toBe(0);
      expect(argmax([1, 1, 1])).toBe(0); // first match
    });

    it('returns -1 for empty array', () => {
      expect(argmax([])).toBe(-1);
    });
  });
});
