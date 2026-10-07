import { OllamaProvider, OllamaOptions } from './ollama.js';

/**
 * Primary Model Provider for EvoJev using Gemma 4 4B QAT
 */
export class GemmaProvider extends OllamaProvider {
  constructor(modelName?: string, options: OllamaOptions = {}) {
    const selectedModel = modelName || process.env.PRIMARY_MODEL || 'gemma4-e4b:latest';
    super(selectedModel, {
      defaultTemperature: 0.2,
      maxRetries: 2,
      ...options,
    });
  }
}

let defaultGemmaInstance: GemmaProvider | null = null;

/**
 * Returns a singleton or shared instance of the primary Gemma provider
 */
export function getPrimaryModelProvider(options?: OllamaOptions): GemmaProvider {
  if (!defaultGemmaInstance || options) {
    defaultGemmaInstance = new GemmaProvider(undefined, options);
  }
  return defaultGemmaInstance;
}
