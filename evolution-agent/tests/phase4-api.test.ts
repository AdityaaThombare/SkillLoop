import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ZodSchema } from 'zod';
import { ModelProvider, ModelResponse } from '../src/models/provider.js';

let app: (typeof import('../src/server.js'))['app'];
let closeDatabase: () => void;
let service: Server;
let serviceBase = '';
let temporaryDirectory = '';
let available = true;
let analysisPayload: unknown = { overview: 'Evidence reviewed.', recommendations: [] };
let analysisFailure = false;
let lastImages: string[] = [];
let analysisCalls = 0;
const mockProvider: ModelProvider = {
  name: 'gemma4-e4b:latest',
  isAvailable: async () => available,
  async generate<T>(_prompt: string, schema: ZodSchema<T>, _format?: Record<string, unknown>, images?: string[]): Promise<ModelResponse<T>> {
    analysisCalls++;
    if (analysisFailure) throw new Error('mock Gemma failure');
    lastImages = images || [];
    let data: T;
    try { data = schema.parse({ type: 'choice', scores: [2, 0], choice: 0 }); }
    catch { data = schema.parse(analysisPayload); }
    return { data, rawText: JSON.stringify(data), latencyMs: 2, tokensUsed: 10, retries: 0 };
  },
};

beforeAll(async () => {
  temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'evoloop-phase4-api-'));
  process.env.NODE_ENV = 'test';
  process.env.EVOLUTION_DB_PATH = path.join(temporaryDirectory, 'phase4.db');
  const module = await import('../src/server.js'); app = module.app;
  closeDatabase = (await import('../src/storage/db.js')).closeDb;
  app.locals.primaryProvider = mockProvider;
  service = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => service.once('listening', resolve));
  const address = service.address(); if (!address || typeof address === 'string') throw new Error('Test service did not bind');
  serviceBase = `http://127.0.0.1:${address.port}`;
}, 30000);

afterAll(async () => {
  await new Promise<void>((resolve) => service?.close(() => resolve()));
  closeDatabase?.();
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function post(endpoint: string, body: unknown) {
  return fetch(`${serviceBase}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function makeZip(name: string, content: string): Buffer {
  const filename=Buffer.from(name),data=Buffer.from(content);let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1;}crc=(crc^0xffffffff)>>>0;
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(filename.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(filename.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+filename.length,12);end.writeUInt32LE(local.length+filename.length+data.length,16);
  return Buffer.concat([local,filename,data,central,filename,end]);
}

describe('Phase 4 calibration and measured routing API', () => {
  it('records real typed decision rows, fits on calibration data only, and reports labeled risk/coverage', async () => {
    const evidenceResponse = await post('/api/evolution/observe', { route: '/test', target: 'calibration fixture', elementFound: true, candidates: [{ selector: '#a', tag: 'button', text: 'A' }, { selector: '#b', tag: 'button', text: 'B' }] });
    const { evidenceId } = await evidenceResponse.json() as { evidenceId: number };
    available = false;
    expect((await post('/api/evolution/phase4/decide', { evidenceId })).status).toBe(503);
    available = true;

    const ids: string[] = [];
    for (let index = 0; index < 8; index++) {
      const response = await post('/api/evolution/phase4/decide', { evidenceId });
      expect(response.status).toBe(200);
      const result = await response.json() as { decisionId: string; rawConfidence: number; calibratedConfidence: number | null; routingDecision: string };
      expect(result.rawConfidence).toBeGreaterThan(0.5);
      expect(result.calibratedConfidence).toBeNull();
      expect(result.routingDecision).toBe('ABSTAIN');
      ids.push(result.decisionId);
    }
    for (let index = 0; index < ids.length; index++) {
      const dataSplit = index < 5 ? 'calibration' : 'validation';
      const actualClass = dataSplit === 'calibration' ? 0 : (index === 6 ? 1 : 0);
      const response = await post('/api/evolution/calibration/labels', { decisionId: ids[index], actualClass, dataSplit });
      expect(response.status).toBe(201);
    }
    const fitResponse = await post('/api/evolution/calibration/fit', {});
    expect(fitResponse.status).toBe(200);
    const fit = await fitResponse.json() as { method: string; trainingSamples: number; validation: { samples: number; ece: number; brierScore: number; reliability: unknown[] } };
    expect(fit.method).toBe('temperature_scaling');
    expect(fit.trainingSamples).toBe(5);
    expect(fit.validation.samples).toBe(3);
    expect(fit.validation.ece).toBeTypeOf('number');
    expect(fit.validation.brierScore).toBeTypeOf('number');
    expect(fit.validation.reliability.length).toBeGreaterThan(0);

    const afterFit = await (await post('/api/evolution/phase4/decide', { evidenceId })).json() as { decisionId: string; calibratedConfidence: number | null; calibrationMethod: string | null };
    expect(afterFit.calibratedConfidence).toBeTypeOf('number');
    expect(afterFit.calibrationMethod).toBe('temperature_scaling');
    const labelAfterFit = await post('/api/evolution/calibration/labels', { decisionId: afterFit.decisionId, actualClass: 0, dataSplit: 'test' });
    expect(labelAfterFit.status).toBe(201);
    const metrics = await (await fetch(`${serviceBase}/api/evolution/risk-coverage`)).json() as { sampleCount: number; calibratedSampleCount: number; coverage: number; selectiveRisk: number | null; abstentionRate: number; secondaryInvocationRate: number; dataset: unknown[] };
    expect(metrics.sampleCount).toBe(9);
    expect(metrics.calibratedSampleCount).toBe(1);
    expect(metrics.coverage).toBe(0);
    expect(metrics.selectiveRisk).toBeNull();
    expect(metrics.abstentionRate).toBe(1);
    expect(metrics.secondaryInvocationRate).toBe(0);
    expect(metrics.dataset).toHaveLength(9);
    const status = await (await fetch(`${serviceBase}/api/evolution/calibration`)).json() as { active: boolean };
    expect(status.active).toBe(true);
  }, 30000);

  it('creates, approves, and plans an evidence-grounded Phase 5 recommendation without applying it', async () => {
    const response = await post('/api/evolution/recommendations', { findings: [{ id: 'phase5-evidence-1', route: '/evolution', kind: 'focus', observed: 'The observed control has no visible focus indicator', selector: '#runDecision' }] });
    expect(response.status).toBe(201);
    const body = await response.json() as { recommendations: Array<{ id: string; category: string; evidenceGrounded: boolean }> };
    expect(body.recommendations[0]).toMatchObject({ category: 'QUICK_WIN', evidenceGrounded: true });
    const id = body.recommendations[0].id;
    expect((await post(`/api/evolution/recommendations/${id}/plan`, { operations: [] })).status).toBe(403);
    expect((await post(`/api/evolution/recommendations/${id}/approval`, { approved: true })).status).toBe(200);
    const plan = await post(`/api/evolution/recommendations/${id}/plan`, { operations: [{ file: 'static/evolution.js', expectedText: 'const base = window.EVOLUTION_SERVICE_URL', replacementText: 'const base = window.EVOLUTION_SERVICE_URL' }] });
    expect(plan.status).toBe(201);
    const planBody = await plan.json() as { diff: string; safety: string };
    expect(planBody.diff).toContain('static/evolution.js');
    expect(planBody.safety).toContain('allowlisted');
  });

  it('analyzes screenshot input with Gemma image payload and filters recommendations not grounded in evidence', async () => {
    analysisPayload = { overview: 'A landing page with a visible unlabeled action.', recommendations: [
      { category: 'ACCESSIBILITY', title: 'Name the action', problem: 'The action is unlabeled.', whyItMatters: 'Screen reader users may not understand it.', evidenceIds: ['screenshot-1'], affectedRoute: '/untrusted', suggestedImprovement: 'Add a concise accessible name.', priority: 'HIGH', impact: 'HIGH', risk: 'LOW' },
      { category: 'UX_IMPROVEMENT', title: 'Add error feedback', problem: 'The screenshot contains no visible error feedback state.', whyItMatters: 'People may need guidance when input fails.', evidenceIds: ['screenshot-1'], affectedRoute: '/', suggestedImprovement: 'Provide an error message for invalid input.', priority: 'MEDIUM', impact: 'MEDIUM', risk: 'LOW' },
      { category: 'UX_IMPROVEMENT', title: 'Ungrounded claim', problem: 'Unknown.', whyItMatters: 'Unknown.', evidenceIds: ['fabricated-id'], affectedRoute: '/', suggestedImprovement: 'Unknown.', priority: 'LOW', impact: 'LOW', risk: 'LOW' },
    ] };
    const png=Buffer.alloc(16);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
    const response=await fetch(`${serviceBase}/api/evolution/analyze/screenshot`,{method:'POST',headers:{'Content-Type':'image/png'},body:png});
    const data=await response.json() as {inputType:string;recommendations:Array<Record<string,unknown>>;calibrationStatus:string;error?:string};expect(response.status, data.error).toBe(201);
    expect(data.inputType).toBe('screenshot');expect(data.recommendations).toHaveLength(2);expect(data.calibrationStatus).toBe('CALIBRATION_REQUIRED');expect(data.recommendations[0]).toMatchObject({category:'ACCESSIBILITY',confidence:null,affectedRoute:'/'});expect(data.recommendations[1]).toMatchObject({category:'FEATURE_OPPORTUNITY',confidence:null});expect(lastImages).toHaveLength(1);
    analysisPayload={overview:'Evidence reviewed.',recommendations:[]};
  });

  it('returns cached screenshot analysis without a second Gemma invocation', async () => {
    const png=Buffer.alloc(20);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(3,16);const before=analysisCalls;
    const first=await fetch(`${serviceBase}/api/evolution/analyze/screenshot`,{method:'POST',headers:{'Content-Type':'image/png'},body:png});expect(first.status).toBe(201);
    const second=await fetch(`${serviceBase}/api/evolution/analyze/screenshot`,{method:'POST',headers:{'Content-Type':'image/png'},body:png});const cached=await second.json() as {cacheHit:boolean;totalLatencyMs:number};
    expect(second.status).toBe(200);expect(cached.cacheHit).toBe(true);expect(cached.totalLatencyMs).toBeGreaterThanOrEqual(0);expect(analysisCalls-before).toBe(1);
  });

  it('analyzes a project ZIP as text without execution and rejects malformed or evidence-free archives', async () => {
    analysisPayload={overview:'The source includes a missing image description.',recommendations:[]};
    const zip=makeZip('src/App.tsx','export function App(){return <img src="hero.png"/>;}');
    const response=await fetch(`${serviceBase}/api/evolution/analyze/zip`,{method:'POST',headers:{'Content-Type':'application/zip','X-Project-Name':'Demo'},body:zip});
    expect(response.status).toBe(201);const data=await response.json() as {inputType:string;evidence:Array<{kind:string}>};expect(data.inputType).toBe('codebase');expect(data.evidence.some((item)=>item.kind==='accessibility')).toBe(true);
    const malformed=await fetch(`${serviceBase}/api/evolution/analyze/zip`,{method:'POST',headers:{'Content-Type':'application/zip'},body:Buffer.from('bad')});expect(malformed.status).toBe(400);
    const emptyZip=makeZip('README.md','# no supported source');const insufficient=await fetch(`${serviceBase}/api/evolution/analyze/zip`,{method:'POST',headers:{'Content-Type':'application/zip'},body:emptyZip});expect(insufficient.status).toBe(400);
    analysisPayload={overview:'Evidence reviewed.',recommendations:[]};
  });

  it('runs the public URL input adapter, rejects unsafe URLs, and fails explicitly when Gemma is unavailable', async () => {
    app.locals.publicPageFetcher=async (url:string)=>({url,status:200,title:'Public fixture',evidence:[{id:'url-page-structure',source:'url',route:'/',kind:'page_structure',observed:'The page has one visible heading.'}]});
    app.locals.uiWebSearch=async()=>[{title:'Accessible navigation guidance',url:'https://www.w3.org/WAI/ARIA/apg/patterns/'}];
    analysisPayload={overview:'Public fixture reviewed.',recommendations:[{category:'UX',title:'Clarify page navigation',problem:'The navigation needs clearer grouping.',whyItMatters:'Clear grouping helps visitors orient.',suggestedImprovement:'Group navigation links by purpose.',priority:'MEDIUM',evidenceIds:['url-page-structure'],webSources:[{title:'Accessible navigation guidance',url:'https://www.w3.org/WAI/ARIA/apg/patterns/'}]}]};
    const result=await post('/api/evolution/analyze/url',{url:'https://8.8.8.8'});expect(result.status).toBe(201);expect((await result.json() as {inputType:string}).inputType).toBe('url');
    analysisPayload={overview:'Public fixture reviewed.',recommendations:[]};
    app.locals.publicPageFetcher=async()=>{throw new Error('Public page fetch failed: fixture unreachable');};const unreachable=await post('/api/evolution/analyze/url',{url:'https://8.8.8.8/unreachable'});expect(unreachable.status).toBe(502);expect((await unreachable.json() as {status:string}).status).toBe('PAGE_UNREACHABLE');
    expect((await post('/api/evolution/analyze/url',{url:'http://127.0.0.1:5050'})).status).toBe(400);
    available=false;const png=Buffer.alloc(20);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(4,16);const unavailable=await fetch(`${serviceBase}/api/evolution/analyze/screenshot`,{method:'POST',headers:{'Content-Type':'image/png'},body:png});expect(unavailable.status).toBe(503);available=true;
    analysisFailure=true;const failedPng=Buffer.from(png);failedPng.writeUInt32BE(5,16);const failed=await fetch(`${serviceBase}/api/evolution/analyze/screenshot`,{method:'POST',headers:{'Content-Type':'image/png'},body:failedPng});expect(failed.status).toBe(502);analysisFailure=false;
    delete app.locals.publicPageFetcher;delete app.locals.uiWebSearch;analysisPayload={overview:'Evidence reviewed.',recommendations:[]};
  });

  it('fails closed for malformed Gemma analysis output and tolerates web-search failure', async () => {
    const png=Buffer.alloc(20);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(6,16);
    // Use a unique valid PNG byte sequence; invalid model payload must produce an explicit typed failure.
    analysisPayload={overview:'',recommendations:[{category:'UNKNOWN',title:'x'}]};
    const malformed=await fetch(`${serviceBase}/api/evolution/analyze/screenshot`,{method:'POST',headers:{'Content-Type':'image/png'},body:png});expect([400,422,502]).toContain(malformed.status);
    analysisPayload={overview:'Evidence reviewed.',recommendations:[]};
    app.locals.publicPageFetcher=async(url:string)=>({url,status:200,title:'Fixture',evidence:[{id:'url-page-structure',source:'url',route:'/',kind:'page_structure',observed:'The page has navigation links.'}]});
    app.locals.uiWebSearch=async()=>{throw new Error('search unavailable');};
    const searched=await post('/api/evolution/analyze/url',{url:'https://8.8.8.8/search-failure'});expect(searched.status).toBe(201);expect((await searched.json() as {webSources:unknown[]}).webSources).toEqual([]);
    delete app.locals.publicPageFetcher;delete app.locals.uiWebSearch;
  });

  it('performs a real Gemma multimodal screenshot analysis when the exact local model is installed', async () => {
    const ollama=process.env.OLLAMA_URL||'http://localhost:11434';let tags:Response;
    try { tags=await fetch(`${ollama.replace(/\/$/,'')}/api/tags`,{signal:AbortSignal.timeout(1500)}); } catch { return; }
    if(!tags.ok)return;const body=await tags.json() as {models?:Array<{name?:string;model?:string}>};if(!(body.models||[]).some((model)=>(model.name||model.model)==='gemma4-e4b:latest'))return;
    const module=await import('../src/models/gemma.js');const liveProvider=new module.GemmaProvider('gemma4-e4b:latest');const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=','base64').toString('base64');
    const started=Date.now();const result=await liveProvider.generate('Analyze this screenshot. Return compact JSON only with overview and up to three recommendations, each containing category,title,problem,whyItMatters,suggestedImprovement,priority,evidenceIds,webSources. The only evidence ID is screenshot-1. If too small to inspect, return an empty recommendations array.',(await import('../src/evolution/application-analysis.js')).UIAnalysisResponseSchema,undefined,[image],{numPredict:128,maxRetries:0});
    const latency=Date.now()-started;expect(result.data.recommendations.length).toBeLessThanOrEqual(5);console.info(`[live-gemma-screenshot] model=${liveProvider.name} latencyMs=${latency} recommendations=${result.data.recommendations.length}`);
  },190000);
});
