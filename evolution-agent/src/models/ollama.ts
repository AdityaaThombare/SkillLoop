import { ZodSchema, z } from 'zod';
import { ModelProvider, ModelResponse, ModelOutputError, ModelUnavailableError, StructuredOutputFormat, StructuredGenerationOptions } from './provider.js';

export interface OllamaOptions {
  baseUrl?: string;
  defaultTemperature?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

interface OllamaRawGenerateResponse {
  model: string;
  response: string;
  thinking?: string;
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements ModelProvider {
  public readonly name: string;
  protected readonly baseUrl: string;
  protected readonly defaultTemperature: number;
  protected readonly maxRetries: number;
  protected readonly timeoutMs: number;
  protected readonly numPredict: number;
  protected readonly keepAlive: string;

  constructor(modelName: string, options: OllamaOptions = {}) {
    this.name = modelName;
    this.baseUrl = (options.baseUrl || process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
    this.defaultTemperature = options.defaultTemperature ?? 0.2;
    this.maxRetries = options.maxRetries ?? 2;
    const configuredTimeout = Number(process.env.OLLAMA_TIMEOUT_MS || 180000);
    this.timeoutMs = options.timeoutMs ?? (Number.isFinite(configuredTimeout) && configuredTimeout >= 1000 ? configuredTimeout : 180000);
    const configuredNumPredict = Number(process.env.OLLAMA_NUM_PREDICT || 128);
    this.numPredict = Number.isFinite(configuredNumPredict) && configuredNumPredict >= 16 ? Math.floor(configuredNumPredict) : 128;
    this.keepAlive = process.env.OLLAMA_KEEP_ALIVE || '10m';
  }

  /**
   * Checks if Ollama daemon is reachable and whether the model is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      let res: Response;
      try { res = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal }); }
      finally { clearTimeout(timeoutId); }

      if (!res.ok) return false;

      const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
      if (!Array.isArray(data.models)) return false;

      // Model selection is intentionally exact: never infer availability from a family prefix.
      return data.models.some((m) => {
        const name = m.name || m.model || '';
        return name === this.name;
      });
    } catch {
      return false;
    }
  }

  /**
   * Helper to clean and extract JSON from raw model string
   */
  protected extractJson(raw: string): unknown {
    const trimmed = raw.trim();

    // 1. Direct parse attempt
    try {
      return JSON.parse(trimmed);
    } catch {
      // Continue to regex recovery
    }

    // 2. Strip markdown fences: ```json ... ```
    const markdownMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (markdownMatch && markdownMatch[1]) {
      try {
        return JSON.parse(markdownMatch[1].trim());
      } catch {
        // Continue to brute-force boundary extraction
      }
    }

    // 3. Extract outermost object {...}
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const candidate = trimmed.substring(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        // Continue
      }
    }

    // 4. Extract outermost array [...]
    const firstBracket = trimmed.indexOf('[');
    const lastBracket = trimmed.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      const candidate = trimmed.substring(firstBracket, lastBracket + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        // Continue
      }
    }

    throw new Error('Unable to extract valid JSON structure from model output');
  }

  /**
   * Generates completion and validates with Zod schema, with retry on failure
   */
  async generate<T>(prompt: string, schema: ZodSchema<T>, format?: StructuredOutputFormat, images?: string[], generationOptions: StructuredGenerationOptions = {}): Promise<ModelResponse<T>> {
    const startTime = Date.now();
    let lastRawText = '';
    let lastZodError: z.ZodError | undefined;
    let lastOutputError = '';
    let totalTokens = 0;

    const retries = generationOptions.maxRetries ?? this.maxRetries;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const temperature = generationOptions.temperature ?? this.defaultTemperature + attempt * 0.1;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      try {
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(`${this.baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.name,
            prompt,
            ...(images?.length ? { images } : {}),
            format: format || 'json',
            think: false,
            keep_alive: this.keepAlive,
            stream: false,
            options: {
              temperature,
              top_p: 0.9,
              seed: 42,
              num_predict: generationOptions.numPredict ?? this.numPredict,
            },
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId); timeoutId = undefined;

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          throw new ModelUnavailableError(`Ollama HTTP ${response.status} for ${this.name}: ${errText.slice(0, 1000)}`, this.name);
        }

        const json = (await response.json()) as OllamaRawGenerateResponse;
        if (json.model && json.model !== this.name) {
          throw new ModelUnavailableError(`Ollama returned model ${json.model}; exact configured tag is ${this.name}`, this.name);
        }
        lastRawText = json.response || '';

        if (!lastRawText.trim()) {
          const thinkingTokens = json.thinking ? json.thinking.trim().split(/\s+/).length : 0;
          lastOutputError = `Ollama returned an empty final response (done_reason=${json.done_reason || 'unknown'}, eval_count=${json.eval_count ?? 'unknown'}, thinking_tokens=${thinkingTokens}); request think=false and verify the model's structured-output support`;
          if (json.done_reason === 'length') break;
          continue;
        }

        const promptTokens = json.prompt_eval_count || 0;
        const evalTokens = json.eval_count || 0;
        totalTokens += promptTokens + evalTokens;

        // Extract JSON
        const parsed = this.extractJson(lastRawText);

        // Validate against Zod schema
        const validation = schema.safeParse(parsed);
        if (validation.success) {
          return {
            data: validation.data,
            rawText: lastRawText,
            latencyMs: Date.now() - startTime,
            tokensUsed: totalTokens,
            retries: attempt,
          };
        } else {
          lastZodError = validation.error;
          lastOutputError = `Zod Choice validation failed: ${validation.error.issues.map((issue) => `${issue.path.join('.') || 'output'} ${issue.message}`).join('; ')}`;
        }
      } catch (err: unknown) {
        if (timeoutId) clearTimeout(timeoutId);
        if (err instanceof Error && err.name === 'AbortError') {
          throw new ModelUnavailableError(`Ollama request timed out after ${this.timeoutMs}ms`, this.name);
        }
        if (err instanceof ModelUnavailableError) throw err;
        // Connection error check on first attempt
        if (err instanceof TypeError) {
          const code = (err as { cause?: { code?: string } }).cause?.code;
          const reason = code === 'ECONNREFUSED' ? 'ECONNREFUSED' : err.message;
          throw new ModelUnavailableError(`Ollama request failed at ${this.baseUrl}: ${reason}`, this.name);
        }
        lastOutputError = err instanceof Error ? err.message : String(err);
      }
    }

    throw new ModelOutputError(
      `Failed to generate valid ${this.name} completion after ${retries + 1} attempts${lastOutputError ? `: ${lastOutputError}` : ''}`,
      lastRawText,
      retries + 1,
      lastZodError
    );
  }
}
