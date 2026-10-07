import { OllamaProvider, OllamaOptions } from './ollama.js';

/**
 * Secondary independent verifier using the installed SmolLM3 3B model tag.
 */
export class SmolLMProvider extends OllamaProvider {
  constructor(modelName?: string, options: OllamaOptions = {}) {
    const selectedModel = modelName || process.env.SECONDARY_MODEL || 'smollm3-3b-q4km:latest';
    super(selectedModel, {
      defaultTemperature: 0.1, // slightly lower temperature for verification consistency
      maxRetries: 2,
      ...options,
    });
  }
}

let defaultSmolLMInstance: SmolLMProvider | null = null;

/**
 * Returns a singleton or shared instance of the secondary SmolLM provider
 */
export function getSecondaryModelProvider(options?: OllamaOptions): SmolLMProvider {
  if (!defaultSmolLMInstance || options) {
    defaultSmolLMInstance = new SmolLMProvider(undefined, options);
  }
  return defaultSmolLMInstance;
}
