import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { OllamaProvider } from '../src/models/ollama.js';
import { GemmaProvider, getPrimaryModelProvider } from '../src/models/gemma.js';
import { SmolLMProvider, getSecondaryModelProvider } from '../src/models/smollm.js';
import { ChoiceOutputSchema } from '../src/decision/schemas.js';
import { ModelOutputError } from '../src/models/provider.js';

let mockServer: http.Server;
let mockPort: number;
let mockResponseHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

beforeAll(async () => {
  mockServer = http.createServer((req, res) => {
    if (mockResponseHandler) {
      mockResponseHandler(req, res);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => {
    mockServer.listen(0, '127.0.0.1', () => {
      const address = mockServer.address();
      if (address && typeof address === 'object') {
        mockPort = address.port;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    mockServer.close(() => resolve());
  });
});

describe('OllamaProvider & Derived Providers', () => {
  it('instantiates GemmaProvider and SmolLMProvider with default names', () => {
    const gemma = new GemmaProvider();
    expect(gemma.name).toBe('gemma4-e4b:latest');

    const smollm = new SmolLMProvider();
    expect(smollm.name).toBe('smollm3-3b-q4km:latest');

    expect(getPrimaryModelProvider()).toBeInstanceOf(GemmaProvider);
    expect(getSecondaryModelProvider()).toBeInstanceOf(SmolLMProvider);
  });

  it('checks isAvailable() returning true when model is in tags', async () => {
    mockResponseHandler = (req, res) => {
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            models: [{ name: 'gemma3:4b' }, { name: 'smollm3-3b-q4km:latest' }],
          })
        );
      }
    };

    const provider = new GemmaProvider('gemma3:4b', {
      baseUrl: `http://127.0.0.1:${mockPort}`,
    });

    const available = await provider.isAvailable();
    expect(available).toBe(true);
  });

  it('checks isAvailable() returning false when model is missing', async () => {
    mockResponseHandler = (req, res) => {
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            models: [{ name: 'llama3:8b' }],
          })
        );
      }
    };

    const provider = new GemmaProvider('gemma3:4b', {
      baseUrl: `http://127.0.0.1:${mockPort}`,
    });

    const available = await provider.isAvailable();
    expect(available).toBe(false);
  });

  it('requires exact model tag equality and does not accept a family prefix or case variant', async () => {
    mockResponseHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'smollm3-3b-q4km:latest' }] }));
    };
    const provider = new SmolLMProvider('smollm3-3b-q4km:Latest', { baseUrl: `http://127.0.0.1:${mockPort}` });
    expect(await provider.isAvailable()).toBe(false);
  });

  it('successfully generates and validates typed Choice output', async () => {
    const mockChoice = {
      type: 'choice',
      scores: [4.2, 1.1, -0.5],
      choice: 0,
      reasoning: 'Candidate 0 matches the expected text.',
    };

    mockResponseHandler = (req, res) => {
      if (req.url === '/api/generate') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            model: 'gemma3:4b',
            response: JSON.stringify(mockChoice),
            done: true,
            prompt_eval_count: 25,
            eval_count: 45,
          })
        );
      }
    };

    const provider = new GemmaProvider('gemma3:4b', {
      baseUrl: `http://127.0.0.1:${mockPort}`,
    });

    const response = await provider.generate('Which button is correct?', ChoiceOutputSchema);
    expect(response.data.choice).toBe(0);
    expect(response.data.scores).toEqual([4.2, 1.1, -0.5]);
    expect(response.tokensUsed).toBe(70);
    expect(response.retries).toBe(0);
    expect(response.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('recovers from markdown-wrapped JSON output', async () => {
    const mockChoice = {
      type: 'choice',
      scores: [3.5, 0.2],
      choice: 0,
    };

    const wrappedText = 'Here is the decision:\n```json\n' + JSON.stringify(mockChoice) + '\n```\nHope this helps!';

    mockResponseHandler = (req, res) => {
      if (req.url === '/api/generate') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            model: 'gemma3:4b',
            response: wrappedText,
            done: true,
          })
        );
      }
    };

    const provider = new GemmaProvider('gemma3:4b', {
      baseUrl: `http://127.0.0.1:${mockPort}`,
    });

    const response = await provider.generate('Select replacement', ChoiceOutputSchema);
    expect(response.data.choice).toBe(0);
    expect(response.data.scores).toHaveLength(2);
  });

  it('retries on invalid model output and throws ModelOutputError if unrecovered', async () => {
    let callCount = 0;

    mockResponseHandler = (req, res) => {
      if (req.url === '/api/generate') {
        callCount++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // Return text that cannot parse into ChoiceOutputSchema
        res.end(
          JSON.stringify({
            model: 'gemma3:4b',
            response: 'I could not make a decision.',
            done: true,
          })
        );
      }
    };

    const provider = new GemmaProvider('gemma3:4b', {
      baseUrl: `http://127.0.0.1:${mockPort}`,
      maxRetries: 2,
    });

    await expect(provider.generate('Broken prompt', ChoiceOutputSchema)).rejects.toThrow(ModelOutputError);

    // Initial attempt + 2 retries = 3 attempts total
    expect(callCount).toBe(3);
  });
});
