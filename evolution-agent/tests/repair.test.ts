import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { z, ZodSchema } from 'zod';
import { ModelProvider, ModelResponse } from '../src/models/provider.js';
import { BrowserManager } from '../src/browser/manager.js';
import { observeTarget } from '../src/browser/observer.js';
import { getTarget } from '../src/browser/registry.js';

const hasChrome = existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
let fixture: Server; let service: Server; let fixtureBase = ''; let serviceBase = ''; let fixtureMode: 'broken' | 'healthy' | 'none' | 'noPostcondition' = 'broken';
let app: (typeof import('../src/server.js'))['app']; let closeDatabase: () => void; let tempDirectory = '';
let modelCalls = 0; let modelScores = [10, 0]; let modelAvailable = true;

const mockProvider: ModelProvider = {
  name: 'gemma4-e4b:latest',
  isAvailable: async () => modelAvailable,
  async generate<T>(prompt: string, schema: ZodSchema<T>): Promise<ModelResponse<T>> {
    modelCalls++;
    const response = schema.parse({ type: 'choice', scores: modelScores, choice: modelScores.indexOf(Math.max(...modelScores)) });
    return { data: response, rawText: JSON.stringify(response), latencyMs: 1, tokensUsed: 10, retries: 0 };
  },
};

function fixtureHtml() {
  if (fixtureMode === 'none') return '<!doctype html><title>Empty fixture</title><main>Nothing here</main>';
  const targetId = fixtureMode === 'healthy' ? 'botFab' : 'assistant-button';
  const openCode = fixtureMode === 'noPostcondition' ? '' : "document.querySelector('#botBox').classList.add('open')";
  return `<!doctype html><title>Repair fixture</title><style>#botBox{display:none}#botBox.open{display:block}</style><button id="${targetId}" aria-label="Open assistant">Open Assistant</button><button id="other">Cancel</button><div id="botBox">Assistant panel</div><script>document.querySelector('#${targetId}').addEventListener('click',()=>{${openCode}})</script>`;
}

beforeAll(async () => {
  tempDirectory = mkdtempSync(path.join(tmpdir(), 'evoloop-phase3-'));
  fixture = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(fixtureHtml()); });
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const fixtureAddress = fixture.address(); if (!fixtureAddress || typeof fixtureAddress === 'string') throw new Error('Fixture did not bind');
  fixtureBase = `http://127.0.0.1:${fixtureAddress.port}`;
  process.env.NODE_ENV = 'test'; process.env.EVOLUTION_DB_PATH = path.join(tempDirectory, 'evolution.db'); process.env.EVOLUTION_TARGET_URL = fixtureBase; process.env.PLAYWRIGHT_HEADLESS = 'true'; process.env.PLAYWRIGHT_CHANNEL = 'chrome'; process.env.EVOLUTION_REPAIR_MIN_CONFIDENCE = '0.80';
  const serverModule = await import('../src/server.js'); app = serverModule.app;
  closeDatabase = (await import('../src/storage/db.js')).closeDb;
  app.locals.primaryProvider = mockProvider;
  service = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => service.once('listening', resolve));
  const serviceAddress = service.address(); if (!serviceAddress || typeof serviceAddress === 'string') throw new Error('Service did not bind');
  serviceBase = `http://127.0.0.1:${serviceAddress.port}`;
}, 30000);

afterAll(async () => {
  await new Promise<void>((resolve) => service?.close(() => resolve()));
  await new Promise<void>((resolve) => fixture?.close(() => resolve()));
  closeDatabase?.();
  if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true });
}, 30000);

async function repair(targetId = 'botFab') {
  return fetch(`${serviceBase}/api/evolution/browser/repair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetId }) });
}

describe.skipIf(!hasChrome)('Phase 3 controlled browser repair integration', () => {
  it('observes and persists the broken registered target, then executes and verifies a typed repair', async () => {
    fixtureMode = 'broken'; modelScores = [10, 0]; modelAvailable = true;
    const response = await repair(); const result = await response.json() as any;
    expect(response.status).toBe(200);
    expect(result.status).toBe('REPAIRED');
    expect(result.failureType).toBe('locator_not_found');
    expect(result.evidenceId).toBeTypeOf('number');
    expect(result.baseline.selectedCandidate).toBe(0);
    expect(result.decision).toMatchObject({ type: 'choice', choice: 0, model: 'gemma4-e4b:latest' });
    expect(result.decision.rawConfidence).toBeGreaterThanOrEqual(0.8);
    expect(result.policy.action).toBe('EXECUTE');
    expect(result.execution).toMatchObject({ attempted: true, selector: '[id="assistant-button"]' });
    expect(result.verification).toMatchObject({ attempted: true, passed: true, expected: '#botBox.open' });
    const history = await (await fetch(`${serviceBase}/api/evolution/repairs`)).json() as any[];
    expect(history.some((row) => row.repair_id === result.repairId && row.final_status === 'REPAIRED')).toBe(true);
  });

  it('returns NO_REPAIR_REQUIRED for a healthy target and rejects unknown target IDs', async () => {
    fixtureMode = 'healthy'; const response = await repair(); const result = await response.json() as any;
    expect(result.status).toBe('NO_REPAIR_REQUIRED');
    const unknown = await repair('http://127.0.0.1/'); expect(unknown.status).toBe(400);
  });

  it('does not call the model when no valid candidate exists', async () => {
    fixtureMode = 'none'; const before = modelCalls; const result = await (await repair()).json() as any;
    expect(result.status).toBe('NO_VALID_CANDIDATE'); expect(modelCalls).toBe(before);
  });

  it('abstains below the raw-confidence threshold without clicking', async () => {
    fixtureMode = 'broken'; modelScores = [0.1, 0]; const result = await (await repair()).json() as any;
    expect(result.status).toBe('ABSTAINED'); expect(result.policy.action).toBe('ABSTAIN'); expect(result.execution.attempted).toBe(false);
  });

  it('fails closed when the exact configured model is unavailable', async () => {
    fixtureMode = 'broken'; modelAvailable = false; const response = await repair(); const result = await response.json() as any;
    expect(response.status).toBe(503); expect(result.status).toBe('DECISION_FAILED'); expect(result.modelUnavailable).toBe(true);
    modelAvailable = true;
  });

  it('reports verification failure when the exact postcondition remains false', async () => {
    fixtureMode = 'noPostcondition'; modelScores = [10, 0]; const result = await (await repair()).json() as any;
    expect(result.status).toBe('VERIFICATION_FAILED'); expect(result.execution.attempted).toBe(true); expect(result.verification.passed).toBe(false);
  });

  it.runIf(process.env.RUN_LIVE_MODEL_TEST === 'true')('uses the exact configured Gemma tag in the controlled browser repair flow', async () => {
    const { GemmaProvider } = await import('../src/models/gemma.js');
    const provider = new GemmaProvider('gemma4-e4b:latest', { timeoutMs: 90000, maxRetries: 0 });
    if (!(await provider.isAvailable())) throw new Error(`Configured model unavailable: ${provider.name}`);
    app.locals.primaryProvider = provider;
    fixtureMode = 'broken';
    const response = await repair(); const result = await response.json() as any;
    if (!result.decision) {
      // A live Ollama timeout or malformed response must be visible, and must never reach execution.
      expect(result.status).toBe('DECISION_FAILED');
      expect(result.execution?.attempted ?? false).toBe(false);
      console.warn(`Live Gemma decision failed safely: ${JSON.stringify(result)}`);
      return;
    }
    expect(result.decision?.model).toBe('gemma4-e4b:latest');
    expect(result.decision?.type).toBe('choice');
    expect(result.status).toMatch(/^(REPAIRED|ABSTAINED|EXECUTION_FAILED|VERIFICATION_FAILED|DECISION_FAILED)$/);
    expect(result.status).not.toBe('NO_REPAIR_REQUIRED');
  }, 120000);
});

describe.skipIf(!hasChrome)('browser manager and target observation', () => {
  it('launches Chrome, observes an existing target, and cleans up', async () => {
    fixtureMode = 'healthy'; const manager = new BrowserManager({ baseUrl: fixtureBase, headless: true, timeoutMs: 5000 });
    const evidence = await observeTarget(manager, getTarget('botFab')!);
    expect(evidence.failureType).toBe('target_found'); expect(evidence.element?.visible).toBe(true); expect(evidence.element?.tagName).toBe('button');
    await manager.close();
  });
  it('observes a missing selector and identifies the assistant replacement candidate', async () => {
    fixtureMode = 'broken'; const manager = new BrowserManager({ baseUrl: fixtureBase, headless: true, timeoutMs: 5000 });
    const evidence = await observeTarget(manager, getTarget('botFab')!);
    expect(evidence.elementFound).toBe(false); expect(evidence.failureType).toBe('locator_not_found');
    expect(evidence.candidates.some((candidate) => candidate.id === 'assistant-button')).toBe(true);
    await manager.close();
  });
  it('rejects non-loopback targets and external navigation paths', () => {
    expect(() => new BrowserManager({ baseUrl: 'https://example.com' })).toThrow('loopback');
    const manager = new BrowserManager({ baseUrl: fixtureBase }); expect(() => manager.url('//example.com')).toThrow('relative paths');
  });
});
