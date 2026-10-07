import { describe, expect, it } from 'vitest';
import { buildAnalysisPrompt, inspectProjectZip, inspectPublicUrl, searchUiReferences, UIAnalysisResponseSchema, validatePublicUrl } from '../src/evolution/application-analysis.js';

function makeZip(name: string, content: string): Buffer {
  const filename = Buffer.from(name); const data = Buffer.from(content); const crc = (buffer: Buffer) => { let c=0xffffffff; for(const byte of buffer){c^=byte;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;}return (c^0xffffffff)>>>0; }; const checksum=crc(data);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(checksum,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(filename.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(checksum,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(filename.length,28);
  const directoryOffset=local.length+filename.length+data.length;const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+filename.length,12);end.writeUInt32LE(directoryOffset,16);
  return Buffer.concat([local,filename,data,central,filename,end]);
}

describe('application analysis input adapters', () => {
  it('blocks local, private, credential-bearing, and non-HTTP URL targets', async () => {
    for (const url of ['file:///C:/secret.txt','http://localhost/','http://127.0.0.1/','http://10.1.2.3/','http://user:pass@example.com/','http://[fd00::1]/']) await expect(validatePublicUrl(url)).rejects.toThrow();
  });

  it('reads ZIP source evidence without extracting or executing files', () => {
    const zip=makeZip('src/App.tsx','export function App(){ return <img src="banner.png"/>; }');
    const evidence=inspectProjectZip(zip);
    expect(evidence.some((item)=>item.kind==='accessibility' && /alt attribute/.test(item.observed))).toBe(true);
    expect(evidence[0].excerpt).toContain('File contents are withheld');
    expect(()=>inspectProjectZip(Buffer.from('not a zip'))).toThrow(/valid ZIP/);
  });

  it('builds a compact evidence-only model prompt', () => {
    const prompt=buildAnalysisPrompt([{id:'e1',source:'codebase',route:'/home',kind:'accessibility',observed:'Image is missing alternative text.'}]);
    expect(prompt).toContain('e1');expect(prompt).toContain('Do not provide code or commands');expect(prompt).not.toContain('whole repository');
  });

  it('normalizes a Gemma recommendation into typed fields without inventing missing impact', () => {
    const parsed=UIAnalysisResponseSchema.parse({overview:'A page with an image.',recommendations:[{category:'Accessibility',description:'Add image alternative text.',evidence:'An image has no alt attribute.',priority:'medium',risk:'low'}]});
    expect(parsed.recommendations[0]).toMatchObject({category:'ACCESSIBILITY',title:'Add image alternative text.',problem:'Add image alternative text.',evidenceIds:[],evidenceText:'An image has no alt attribute.',priority:'MEDIUM',impact:null,risk:'LOW',webSources:[]});
  });

  it('fetches bounded static HTML directly without executing scripts and extracts concise UI evidence', async () => {
    let requested: URL | undefined;
    const html='<html><head><title>Example</title></head><body><h1>Welcome</h1><nav><a href="/about">About</a></nav><input id="email"><script>window.didRun=true</script></body></html>';
    const result=await inspectPublicUrl('https://8.8.8.8/page',async (url)=>{requested=url;return {status:200,headers:{'content-type':'text/html'},body:Buffer.from(html)};});
    expect(requested?.pathname).toBe('/page');expect(result.title).toBe('Example');expect(result.evidence.some((entry)=>entry.id==='url-control-1'&&/no accessible name/.test(entry.observed))).toBe(true);expect(JSON.stringify(result.evidence)).not.toContain('window.didRun');
  });

  it('validates each redirect and returns an explicit fetch failure', async () => {
    await expect(inspectPublicUrl('https://8.8.8.8',async()=>({status:302,headers:{location:'http://127.0.0.1/admin'},body:Buffer.alloc(0)}))).rejects.toThrow(/private or non-public/);
    await expect(inspectPublicUrl('https://8.8.8.8',async()=>{throw new Error('fixture unavailable');})).rejects.toThrow(/Public page fetch failed/);
  });

  it('fails web reference search closed when the search service is unavailable', async () => {
    const failure=async()=>{throw new Error('offline');};
    await expect(searchUiReferences('accessible navigation',failure as typeof fetch)).resolves.toEqual([]);
  });
});
