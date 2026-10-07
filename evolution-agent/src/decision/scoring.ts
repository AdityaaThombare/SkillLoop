/**
 * Mathematical utilities for decision probability and uncertainty signals.
 */

/**
 * Computes the softmax over a numeric array to produce a valid probability distribution.
 * Implements standard numerically stable softmax by subtracting the max.
 */
export function softmax(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const maxScore = Math.max(...scores);
  const exps = scores.map(s => Math.exp(s - maxScore));
  const sumExps = exps.reduce((acc, val) => acc + val, 0);
  return exps.map(e => e / sumExps);
}

/**
 * Computes normalized Shannon entropy of a probability distribution.
 * Normalized to [0, 1] by dividing by log(N).
 * If there is 1 or fewer elements, entropy is 0.
 */
export function entropy(probs: number[]): number {
  if (probs.length <= 1) return 0;
  
  let h = 0;
  for (const p of probs) {
    if (p > 0) {
      h -= p * Math.log(p);
    }
  }
  
  // Normalize by log(N)
  return h / Math.log(probs.length);
}

/**
 * Computes the margin between the top two probabilities.
 * Margin = P_top1 - P_top2. Returns 0 if < 2 probabilities.
 */
export function margin(probs: number[]): number {
  if (probs.length < 2) return 0;
  
  const sorted = [...probs].sort((a, b) => b - a);
  return sorted[0] - sorted[1];
}

/**
 * Returns the index of the maximum value in the array.
 */
export function argmax(values: number[]): number {
  if (values.length === 0) return -1;
  let maxIdx = 0;
  let maxVal = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] > maxVal) {
      maxVal = values[i];
      maxIdx = i;
    }
  }
  return maxIdx;
}
