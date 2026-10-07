import { z, ZodSchema } from 'zod';

/**
 * Standard response from any ModelProvider
 */
export interface ModelResponse<T> {
  data: T;
  rawText: string;
  latencyMs: number;
  tokensUsed?: number;
  retries: number;
}

/** Optional JSON Schema passed to providers that support constrained structured output. */
export type StructuredOutputFormat = Record<string, unknown>;
export type StructuredGenerationOptions = { numPredict?: number; temperature?: number; maxRetries?: number };

/**
 * Error thrown when a model output fails to parse or validate against schema after retries
 */
export class ModelOutputError extends Error {
  public readonly rawText: string;
  public readonly attempts: number;
  public readonly validationErrors?: z.ZodError;

  constructor(message: string, rawText: string, attempts: number, validationErrors?: z.ZodError) {
    super(message);
    this.name = 'ModelOutputError';
    this.rawText = rawText;
    this.attempts = attempts;
    this.validationErrors = validationErrors;
  }
}

/**
 * Error thrown when the model provider/service is unavailable or unreachable
 */
export class ModelUnavailableError extends Error {
  public readonly providerName: string;

  constructor(message: string, providerName: string) {
    super(message);
    this.name = 'ModelUnavailableError';
    this.providerName = providerName;
  }
}

/**
 * Core interface for LLM/SLM inference providers
 */
export interface ModelProvider {
  /**
   * Exact Ollama model tag (e.g., 'gemma4-e4b:latest', 'smollm3-3b-q4km:latest')
   */
  readonly name: string;

  /**
   * Generates a typed completion validated against a Zod schema
   */
  generate<T>(prompt: string, schema: ZodSchema<T>, format?: StructuredOutputFormat, images?: string[], options?: StructuredGenerationOptions): Promise<ModelResponse<T>>;

  /**
   * Health-checks whether the underlying model service and model weights are reachable
   */
  isAvailable(): Promise<boolean>;
}
