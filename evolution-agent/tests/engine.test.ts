import { describe, it, expect } from 'vitest';
import { DecisionEngine } from '../src/decision/engine.js';
import { ModelProvider } from '../src/models/provider.js';
import { z } from 'zod';
import { Candidate } from '../src/decision/schemas.js';

class MockProvider implements ModelProvider {
  public readonly name: string;
  private mockScores: number[];

  constructor(name: string, mockScores: number[]) {
    this.name = name;
    this.mockScores = mockScores;
  }

  async isAvailable(): Promise<boolean> { return true; }

  async generate<T>(prompt: string, schema: z.ZodSchema<T>) {
    const data = schema.parse({
      type: 'choice',
      scores: this.mockScores,
      choice: this.mockScores.indexOf(Math.max(...this.mockScores))
    });
    return {
      data,
      rawText: JSON.stringify(data),
      latencyMs: 100,
      tokensUsed: 20,
      retries: 0
    };
  }
}

describe('DecisionEngine', () => {
  const dummyCandidates: Candidate[] = [
    { selector: '#a', tag: 'div', visible: true, enabled: true, deterministicScore: 0 },
    { selector: '#b', tag: 'div', visible: true, enabled: true, deterministicScore: 0 }
  ];

  it('routes CRITICAL risk to human regardless of confidence', async () => {
    // Very high confidence mock [100, 0] -> ~1.0 prob
    const primary = new MockProvider('primary', [100, 0]); 
    const engine = new DecisionEngine(primary);
    
    const result = await engine.evaluateCandidates(dummyCandidates, 'prompt', 'CRITICAL');
    expect(result.action).toBe('human');
    expect(result.decision.confidence).toBeCloseTo(1.0);
  });

  it('executes LOW risk if confidence >= threshold', async () => {
    const primary = new MockProvider('primary', [10, 0]); // Confident
    const engine = new DecisionEngine(primary, undefined, { lowRiskThreshold: 0.9 });
    
    const result = await engine.evaluateCandidates(dummyCandidates, 'prompt', 'LOW');
    expect(result.action).toBe('execute');
  });

  it('abstains LOW risk if confidence < threshold', async () => {
    const primary = new MockProvider('primary', [1, 0.9]); // Low confidence
    const engine = new DecisionEngine(primary, undefined, { lowRiskThreshold: 0.9 });
    
    const result = await engine.evaluateCandidates(dummyCandidates, 'prompt', 'LOW');
    expect(result.action).toBe('abstain');
  });

  it('invokes secondary for MEDIUM risk and executes if verified', async () => {
    const primary = new MockProvider('primary', [10, 0]); // Confident, choice 0
    const secondary = new MockProvider('secondary', [10, 0]); // Agrees, choice 0
    const engine = new DecisionEngine(primary, secondary, { mediumRiskThreshold: 0.8 });
    
    const result = await engine.evaluateCandidates(dummyCandidates, 'prompt', 'MEDIUM');
    expect(result.secondaryInvoked).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.action).toBe('execute');
  });

  it('abstains for MEDIUM risk if secondary disagrees', async () => {
    const primary = new MockProvider('primary', [10, 0]); // Confident, choice 0
    const secondary = new MockProvider('secondary', [0, 10]); // Disagrees, choice 1
    const engine = new DecisionEngine(primary, secondary, { mediumRiskThreshold: 0.8 });
    
    const result = await engine.evaluateCandidates(dummyCandidates, 'prompt', 'MEDIUM');
    expect(result.secondaryInvoked).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.action).toBe('abstain');
  });
});
