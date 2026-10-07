import { describe, it, expect, vi } from 'vitest';
import { choice, score, noul } from '../src/decision/primitives.js';
import { ModelProvider } from '../src/models/provider.js';
import { z } from 'zod';

class MockProvider implements ModelProvider {
  public readonly name = 'mock-provider';
  private mockResponse: any;

  constructor(mockResponse: any) {
    this.mockResponse = mockResponse;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async generate<T>(prompt: string, schema: z.ZodSchema<T>) {
    const data = schema.parse(this.mockResponse);
    return {
      data,
      rawText: JSON.stringify(data),
      latencyMs: 150,
      tokensUsed: 42,
      retries: 0
    };
  }
}

describe('Decision Primitives', () => {
  it('computes probabilities and uncertainty correctly for choice()', async () => {
    const mockChoice = {
      type: 'choice',
      scores: [2.0, 0.5, 0.1], // highest is index 0
      choice: 0
    };
    
    const provider = new MockProvider(mockChoice);
    const result = await choice(provider, 'Select the best candidate');
    
    expect(result.raw.type).toBe('choice');
    expect(result.selectedIdx).toBe(0);
    // Softmax of [2, 0.5, 0.1]
    expect(result.probabilities[0]).toBeGreaterThan(0.7);
    expect(result.confidence).toBe(result.probabilities[0]);
    expect(result.marginScore).toBe(result.probabilities[0] - result.probabilities[1]);
    expect(result.entropyScore).toBeGreaterThan(0);
    expect(result.entropyScore).toBeLessThan(1);
    expect(result.tokensUsed).toBe(42);
  });

  it('computes correctly for score()', async () => {
    const mockScore = {
      type: 'score',
      scores: [0.1, 0.2, 0.5, 4.0, 1.2], // index 3 is highest
    };

    const provider = new MockProvider(mockScore);
    const result = await score(provider, 'Score this candidate');

    expect(result.raw.type).toBe('score');
    expect(result.selectedIdx).toBe(3);
    expect(result.confidence).toBeGreaterThan(0.8); // softmax(4.0 vs others) is high
    expect(result.probabilities.length).toBe(5);
  });

  it('computes correctly for noul()', async () => {
    const mockNoul = {
      type: 'noul',
      scores: { yes: 5.0, no: 1.0 } // yes is highest -> index 0
    };

    const provider = new MockProvider(mockNoul);
    const result = await noul(provider, 'Is this correct?');

    expect(result.raw.type).toBe('noul');
    expect(result.selectedIdx).toBe(0); // yes
    expect(result.probabilities.length).toBe(2);
    expect(result.probabilities[0]).toBeGreaterThan(0.9);
  });

  it('applies temperature scaling in choice()', async () => {
    const mockChoice = {
      type: 'choice',
      scores: [2.0, 1.0],
      choice: 0
    };
    const provider = new MockProvider(mockChoice);
    
    // T = 1.0 (default)
    const resultT1 = await choice(provider, 'test', 1.0);
    
    // T = 2.0 (softer distribution)
    const resultT2 = await choice(provider, 'test', 2.0);
    
    // T = 0.5 (sharper distribution)
    const resultT5 = await choice(provider, 'test', 0.5);

    expect(resultT1.confidence).toBeGreaterThan(resultT2.confidence); // Softer = less confident
    expect(resultT5.confidence).toBeGreaterThan(resultT1.confidence); // Sharper = more confident
  });
});
