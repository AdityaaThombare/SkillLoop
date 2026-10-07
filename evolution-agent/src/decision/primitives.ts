import { ModelProvider } from '../models/provider.js';
import {
  ChoiceOutputSchema,
  ChoiceOutput,
  ScoreOutputSchema,
  ScoreOutput,
  NoulOutputSchema,
  NoulOutput,
  isChoiceArgmaxConsistent
} from './schemas.js';
import { choiceOllamaFormat } from './schemas.js';
import { softmax, entropy, margin, argmax } from './scoring.js';
import { z } from 'zod';

export interface DecisionResult<T> {
  raw: T;
  probabilities: number[];
  selectedIdx: number;
  confidence: number; // max probability
  marginScore: number;
  entropyScore: number;
  tokensUsed?: number;
  latencyMs: number;
  retries: number;
  prompt: string;
}

/**
 * Executes a 'choice' primitive. The LLM selects the best candidate out of N options.
 */
export async function choice(
  provider: ModelProvider,
  prompt: string,
  temperatureScale: number = 1.0,
  candidateCount?: number
): Promise<DecisionResult<ChoiceOutput>> {
  const response = await provider.generate(prompt, ChoiceOutputSchema, choiceOllamaFormat(candidateCount));
  
  // Apply temperature scaling before softmax
  const scaledScores = response.data.scores.map(s => s / temperatureScale);
  const probs = softmax(scaledScores);
  
  const selectedIdx = argmax(probs);
  
  // Note: we might want to check isChoiceArgmaxConsistent(response.data) 
  // but for mathematical rigorousness, we use the argmax of the scores.

  return {
    raw: response.data,
    probabilities: probs,
    selectedIdx: selectedIdx,
    confidence: probs[selectedIdx] ?? 0,
    marginScore: margin(probs),
    entropyScore: entropy(probs),
    tokensUsed: response.tokensUsed,
    latencyMs: response.latencyMs,
    retries: response.retries,
    prompt
  };
}

/**
 * Executes a 'score' primitive. The LLM assigns scores to 5 ordinal bins.
 * Bins represent levels: 1-2 (very low), 3-4 (low), 5-6 (medium), 7-8 (high), 9-10 (critical).
 */
export async function score(
  provider: ModelProvider,
  prompt: string,
  temperatureScale: number = 1.0
): Promise<DecisionResult<ScoreOutput>> {
  const response = await provider.generate(prompt, ScoreOutputSchema);
  
  const scaledScores = response.data.scores.map(s => s / temperatureScale);
  const probs = softmax(scaledScores);
  
  const selectedIdx = argmax(probs);

  return {
    raw: response.data,
    probabilities: probs,
    selectedIdx: selectedIdx,
    confidence: probs[selectedIdx] ?? 0,
    marginScore: margin(probs),
    entropyScore: entropy(probs),
    tokensUsed: response.tokensUsed,
    latencyMs: response.latencyMs,
    retries: response.retries,
    prompt
  };
}

/**
 * Executes a 'noul' primitive. A binary yes/no decision.
 */
export async function noul(
  provider: ModelProvider,
  prompt: string,
  temperatureScale: number = 1.0
): Promise<DecisionResult<NoulOutput>> {
  const response = await provider.generate(prompt, NoulOutputSchema);
  
  const rawScores = [response.data.scores.yes, response.data.scores.no];
  const scaledScores = rawScores.map(s => s / temperatureScale);
  const probs = softmax(scaledScores);
  
  const selectedIdx = argmax(probs); // 0 = yes, 1 = no

  return {
    raw: response.data,
    probabilities: probs,
    selectedIdx: selectedIdx,
    confidence: probs[selectedIdx] ?? 0,
    marginScore: margin(probs),
    entropyScore: entropy(probs),
    tokensUsed: response.tokensUsed,
    latencyMs: response.latencyMs,
    retries: response.retries,
    prompt
  };
}
