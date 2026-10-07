import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { z } from 'zod';

export const AnalysisCategorySchema = z.enum(['QUICK_WIN', 'UX_IMPROVEMENT', 'FEATURE_OPPORTUNITY', 'ACCESSIBILITY', 'VISUAL_UI']);
export const EvidenceItemSchema = z.object({ id: z.string().min(1).max(120), source: z.enum(['screenshot', 'url', 'codebase']), route: z.string().max(1000), kind: z.string().min(1).max(80), observed: z.string().min(1).max(1200), excerpt: z.string().max(1400).optional() }).strict();
const upperEnum = (value: unknown) => typeof value === 'string' ? value.trim().toUpperCase().replace(/[ -/]+/g, '_') : value;
const normalizeCategory = (value: unknown) => {
  const normalized = String(upperEnum(value) || '');
  if (normalized === 'QUICK_WINS' || normalized === 'QUICK_WIN') return 'QUICK_WIN';
  if (normalized === 'UX_IMPROVEMENT' || normalized === 'UX_IMPROVEMENTS') return 'UX_IMPROVEMENT';
  if (normalized === 'UX') return 'UX_IMPROVEMENT';
  if (normalized === 'FEATURE_OPPORTUNITY' || normalized === 'FEATURE_OPPORTUNITIES') return 'FEATURE_OPPORTUNITY';
  if (normalized === 'ACCESSIBILITY') return 'ACCESSIBILITY';
  if (normalized === 'VISUAL_UI' || normalized === 'VISUAL') return 'VISUAL_UI';
  return value;
};
const nullableRank = z.preprocess((value) => value == null || value === '' ? null : upperEnum(value), z.enum(['LOW','MEDIUM','HIGH']).nullable());
const WebSourceSchema = z.object({ title: z.string().trim().min(1).max(240), url: z.string().url().max(2048), snippet: z.string().max(500).optional() }).strict();
const recommendationDraft = z.preprocess((raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const value = raw as Record<string, unknown>;
  const description = typeof value.description === 'string' ? value.description : undefined;
  const name = typeof value.title === 'string' ? value.title : undefined;
  const directEvidence = Array.isArray(value.evidenceIds) ? value.evidenceIds : [];
  const evidenceText = value.evidenceText ?? value.evidence;
  return { ...value, category: normalizeCategory(value.category), title: name || description, problem: value.problem || description, whyItMatters: value.whyItMatters || value.rationale || value.reason || description, evidenceIds: directEvidence, evidenceText: typeof evidenceText === 'string' ? evidenceText : Array.isArray(evidenceText) ? evidenceText.map((entry) => typeof entry === 'string' ? entry : entry && typeof entry === 'object' ? JSON.stringify(entry) : '').join(' ') : undefined, suggestedImprovement: value.suggestedImprovement || value.recommendation || value.improvement || description, priority: value.priority, impact: value.impact ?? null, risk: value.risk == null ? null : upperEnum(value.risk), webSources: Array.isArray(value.webSources) ? value.webSources : [] };
}, z.object({ category: AnalysisCategorySchema, title: z.string().trim().min(1).max(180), problem: z.string().trim().min(1).max(500), whyItMatters: z.string().trim().min(1).max(500), evidenceIds: z.array(z.string().min(1)).max(15), evidenceText: z.string().max(700).optional(), affectedRoute: z.string().max(1000).optional(), suggestedImprovement: z.string().trim().min(1).max(500), priority: nullableRank, impact: nullableRank, risk: z.preprocess((value) => value == null || value === '' ? null : upperEnum(value), z.enum(['LOW','MEDIUM','HIGH','CRITICAL']).nullable()), webSources: z.array(WebSourceSchema).max(5) }).passthrough());
export type UIRecommendationDraft = { category: z.infer<typeof AnalysisCategorySchema>; title: string; problem: string; whyItMatters: string; evidenceIds: string[]; evidenceText?: string; affectedRoute?: string; suggestedImprovement: string; priority: 'LOW'|'MEDIUM'|'HIGH'|null; impact: 'LOW'|'MEDIUM'|'HIGH'|null; risk: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'|null; webSources: Array<z.infer<typeof WebSourceSchema>> };
export const UIAnalysisResponseSchema = z.object({ overview: z.string().trim().min(1).max(500).optional().default('UI evidence analyzed.'), recommendations: z.array(recommendationDraft).max(5) }).passthrough();
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
export type UIAnalysisResponse = z.infer<typeof UIAnalysisResponseSchema>;

export function buildAnalysisPrompt(evidence: EvidenceItem[], sources: Array<{title:string;url:string;snippet?:string}> = []): string {
  return `Return compact JSON only: {"overview":"...","recommendations":[{"category":"UX","title":"...","problem":"...","whyItMatters":"...","suggestedImprovement":"...","priority":"HIGH","confidence":null,"evidenceIds":["ev_id"],"webSources":[]}]} . Give up to 3 concise recommendations, max 5. Use only supplied evidence IDs and web source URLs. Never invent evidence, confidence, or sources; omit webSources if unused. A numeric confidence is allowed only when provided by a calibrated estimate; otherwise omit it. Separate confirmed defects from feature suggestions; label opportunities as FEATURE_OPPORTUNITY and say they are suggestions, not defects. Do not provide code or commands. Categories: UX, QUICK_WIN, FEATURE_OPPORTUNITY, ACCESSIBILITY, VISUAL_UI. Priority: LOW, MEDIUM, HIGH. Evidence: ${JSON.stringify(evidence).slice(0, 8500)}. Relevant references: ${JSON.stringify(sources).slice(0, 2200)}`;
}

const isPrivateIPv4 = (ip: string) => {
  const p = ip.split('.').map(Number); if (p.length !== 4 || p.some((v) => v < 0 || v > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 2 || b === 168)) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0) || a >= 224;
};
const isPrivateAddress = (address: string) => {
  const version = net.isIP(address); if (!version) return true;
  if (version === 4) return isPrivateIPv4(address);
  const ip = address.toLowerCase();
  if (ip.startsWith('::ffff:')) { const mapped = ip.slice(7); return net.isIP(mapped) === 4 ? isPrivateIPv4(mapped) : true; }
  return ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || /^fe[89ab]/.test(ip) || ip.startsWith('ff') || ip.startsWith('2001:db8:');
};

export async function validatePublicUrl(value: string): Promise<URL> {
  let url: URL; try { url = new URL(value); } catch { throw new Error('Enter a valid public HTTP or HTTPS URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only public HTTP and HTTPS URLs are supported');
  if (url.username || url.password) throw new Error('URLs containing credentials are not allowed');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) throw new Error('Private and local network targets are not allowed');
  const directIp = net.isIP(hostname) ? [hostname] : (await dns.lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
  if (!directIp.length || directIp.some(isPrivateAddress)) throw new Error('URL resolves to a private or non-public network address');
  url.hash = '';
  return url;
}

type DirectResponse = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };
type Requester = (url: URL) => Promise<DirectResponse>;
function publicAddresses(addresses: Array<{address:string}>): Array<{address:string}> {
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error('URL resolves to a private or non-public network address');
  return addresses;
}
async function requestPublicPage(url: URL): Promise<DirectResponse> {
  const addresses = publicAddresses(net.isIP(url.hostname) ? [{address:url.hostname}] : await dns.lookup(url.hostname,{all:true,verbatim:true}));
  const chosen = addresses[0]; const client = url.protocol === 'https:' ? https : http;
  return await new Promise((resolve,reject) => {
    const req = client.request(url,{method:'GET',headers:{'User-Agent':'EvoLoop-UI-Analyzer/1.0','Accept':'text/html,application/xhtml+xml','Accept-Encoding':'identity'},timeout:7000,lookup:((_hostname:string,_options:unknown,callback:(error:NodeJS.ErrnoException|null,address:string,family:number)=>void)=>callback(null,chosen.address,net.isIP(chosen.address))) as never},(res)=>{
      const chunks:Buffer[]=[];let size=0;res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>512*1024){req.destroy(new Error('Page HTML exceeds 512 KB analysis limit'));return;}chunks.push(Buffer.from(chunk));});
      res.on('end',()=>resolve({status:res.statusCode||0,headers:res.headers,body:Buffer.concat(chunks)}));
      res.on('error',reject);
    });
    req.on('timeout',()=>req.destroy(new Error('Public page fetch timed out after 7000ms')));req.on('error',reject);req.end();
  });
}
async function fetchPublicHtml(inputUrl:string, requester:Requester=requestPublicPage):Promise<{url:URL;status:number;html:string}> {
  let current=await validatePublicUrl(inputUrl);
  for(let redirect=0;redirect<=3;redirect++){
    let response:DirectResponse;try{response=await requester(current);}catch(error){throw new Error(`Public page fetch failed: ${error instanceof Error?error.message:String(error)}`);}
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.location;if(!location)throw new Error('Public page returned a redirect without a destination');
      if(redirect===3)throw new Error('Public page exceeded the redirect limit');
      current=await validatePublicUrl(new URL(location,current).toString());continue;
    }
    if(response.status<200||response.status>=400)throw new Error(`Public page returned HTTP ${response.status}`);
    const type=String(response.headers['content-type']||'').toLowerCase();if(!/text\/html|application\/xhtml\+xml/.test(type))throw new Error('Public URL did not return an HTML page');
    return {url:current,status:response.status,html:response.body.toString('utf8')};
  }
  throw new Error('Public page redirect limit exceeded');
}
const decodeHtml=(value:string)=>value.replace(/&#(\d+);/g,(_m,n)=>String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi,(_m,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
const plainText=(value:string)=>decodeHtml(value.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
function attributes(tag:string):Record<string,string>{const result:Record<string,string>={};for(const match of tag.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)){const key=match[1].toLowerCase();if(key!=='<'&&key!=='a'&&key!=='input'&&key!=='button'&&key!=='label'&&key!=='select'&&key!=='textarea')result[key]=decodeHtml(match[2]??match[3]??match[4]??'');}return result;}
export async function inspectPublicUrl(inputUrl:string,requester:Requester=requestPublicPage):Promise<{url:string;status:number;title:string;evidence:EvidenceItem[]}>{
  const fetched=await fetchPublicHtml(inputUrl,requester);const html=fetched.html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|noscript|svg|iframe|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ');
  const title=plainText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'')||'(untitled page)';
  const headings=Array.from(html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]\s*>/gi)).slice(0,12).map((m)=>plainText(m[1]).slice(0,140)).filter(Boolean);
  const labels=new Map<string,string>();for(const m of html.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label\s*>/gi)){const a=attributes(m[1]);if(a.for)labels.set(a.for,plainText(m[2]).slice(0,100));}
  const controls:Array<Record<string,string>>=[];const unlabeled:Array<Record<string,string>>=[];
  const controlRe=/<(button|a|select|textarea)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<(input)\b([^>]*)\/?>/gi;
  for(const m of html.matchAll(controlRe)){const tag=String(m[1]||m[4]).toLowerCase();const attrs=attributes(m[2]||m[5]||'');const text=plainText(m[3]||'').slice(0,100);const href=tag==='a'&&attrs.href?(()=>{try{const u=new URL(attrs.href,fetched.url);u.search='';u.hash='';return u.origin===fetched.url.origin?u.pathname:u.origin;}catch{return '';}})():'';const control={tag,text,ariaLabel:attrs['aria-label']||'',labelledBy:attrs['aria-labelledby']||'',label:attrs.id?labels.get(attrs.id)||'':'',placeholder:attrs.placeholder||'',role:attrs.role||'',type:attrs.type||'',href,ariaLive:attrs['aria-live']||'',style:attrs.style||''};controls.push(control);if(['button','input','select','textarea'].includes(tag)&&!control.ariaLabel&&!control.labelledBy&&!control.label&&!control.text&&!control.placeholder)unlabeled.push(control);}
  const navLinks=controls.filter((entry)=>entry.tag==='a').slice(0,20).map(({text,href})=>({text,href}));
  const inlineStyles=Array.from(html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)).map((m)=>m[1]).join('\n').slice(0,4000);
  const focusEvidence=inlineStyles?(/:focus(?:-visible)?\b/i.test(inlineStyles)?'Inline CSS defines a focus/focus-visible rule.':'Inline CSS contains no focus/focus-visible rule.'):'No inline stylesheet was available; linked stylesheet URLs were not fetched.';
  const meta=Array.from(html.matchAll(/<meta\b[^>]*>/gi)).map((m)=>attributes(m[0])).find((a)=>a.name?.toLowerCase()==='description')?.content||'';
  const bodyText=plainText(html.replace(/<(style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')).slice(0,1800);
  const route=fetched.url.pathname||'/';const structureId='url-page-structure';
  const evidence:EvidenceItem[]=[{id:structureId,source:'url',route,kind:'page_structure',observed:`Page title: ${title}. Visible headings: ${headings.join(' | ')||'(none in static HTML)'}.`,excerpt:JSON.stringify({description:meta.slice(0,240),navigation:navLinks,controls:controls.slice(0,40),forms:(html.match(/<form\b/gi)||[]).length,liveRegions:(html.match(/aria-live\s*=/gi)||[]).length,focusEvidence,inlineStyles: inlineStyles.replace(/\s+/g,' ').slice(0,900),bodyText}).slice(0,7000)}];
  for(const [i,control] of unlabeled.slice(0,15).entries())evidence.push({id:`url-control-${i+1}`,source:'url',route,kind:'accessibility',observed:`Static HTML ${control.tag}${control.type?` type=${control.type}`:''} has no accessible name, associated label, text, or placeholder.`,excerpt:JSON.stringify(control)});
  if(!headings.length&&controls.length===0&&/<script\b/i.test(fetched.html))evidence.push({id:'url-client-shell',source:'url',route,kind:'client_rendered_shell',observed:'The page appears to rely on client-side rendering. Page JavaScript was not executed, so page-specific UI evidence is limited to its static HTML shell.'});
  const persisted=new URL(fetched.url);persisted.search='';persisted.hash='';return {url:persisted.origin+persisted.pathname,status:fetched.status,title,evidence};
}

export function searchQueryForEvidence(evidence:EvidenceItem[]):string|undefined{
  const text=evidence.map((item)=>`${item.kind} ${item.observed}`).join(' ').toLowerCase();
  if(/contrast|colour|color/.test(text))return 'W3C WCAG accessible text contrast UI';
  if(/accessib|aria|label|focus/.test(text))return 'W3C accessible form labels keyboard focus design';
  if(/navigation|menu|wayfinding/.test(text))return 'Nielsen Norman navigation usability patterns';
  if(/empty state|loading|error feedback/.test(text))return 'accessible loading and error feedback interface patterns';
  return undefined;
}
export async function searchUiReferences(query:string,fetcher:typeof fetch=fetch):Promise<Array<{title:string;url:string;snippet?:string}>>{
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),3000);
  try{
    const response=await fetcher(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,{headers:{'User-Agent':'EvoLoop-UI-Analyzer/1.0','Accept':'text/html'},signal:controller.signal,redirect:'error'});if(!response.ok)return [];
    const reader=response.body?.getReader();if(!reader)return [];const chunks:Uint8Array[]=[];let length=0;while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>180000){await reader.cancel();break;}chunks.push(part.value);}const page=Buffer.concat(chunks.map((chunk)=>Buffer.from(chunk))).toString('utf8');
    const decode=(v:string)=>plainText(v);const sources:Array<{title:string;url:string;snippet?:string}>=[];
    for(const match of page.matchAll(/<a\b([^>]*class=["'][^"']*result__a[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi)){const attrs=attributes(match[1]);let url='';try{const raw=new URL(attrs.href||'', 'https://html.duckduckgo.com');url=raw.searchParams.get('uddg')||raw.toString();const target=await validatePublicUrl(url);target.search='';target.hash='';url=target.toString();}catch{continue;}const title=decode(match[2]).slice(0,180);if(title&&!sources.some((entry)=>entry.url===url))sources.push({title,url});if(sources.length>=3)break;}
    return sources;
  }catch{return [];}finally{clearTimeout(timer);}
}

const allowedCode = /\.(?:html?|css|[cm]?[jt]sx?|vue|svelte|json)$/i;
const ignoredPath = /(^|\/)(?:node_modules|\.git|dist|build|coverage|\.next|vendor|venv|\.venv)(\/|$)|(?:^|\/)(?:\.env(?:\.|$)|.*(?:secret|credential|password).*)/i;
const crcTable = (() => { const table = new Uint32Array(256); for (let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;table[i]=c>>>0;}return table; })();
const crc32 = (buffer: Buffer) => { let c=0xffffffff; for(const value of buffer)c=crcTable[(c^value)&0xff]^(c>>>8); return (c^0xffffffff)>>>0; };

/** Reads selected text files directly from ZIP records; never extracts or executes archive contents. */
export function inspectProjectZip(buffer: Buffer): EvidenceItem[] {
  if (buffer.length < 22 || buffer.length > 25 * 1024 * 1024 || buffer.readUInt32LE(0) !== 0x04034b50) throw new Error('Upload a valid ZIP archive under 25 MB');
  let eocd = -1; for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('ZIP central directory is missing or malformed');
  const count = buffer.readUInt16LE(eocd + 10); const centralSize = buffer.readUInt32LE(eocd + 12); let offset = buffer.readUInt32LE(eocd + 16);
  if (count > 5000 || offset + centralSize > buffer.length) throw new Error('ZIP archive exceeds supported entry limits');
  const evidence: EvidenceItem[] = []; let totalInflated = 0; let inspected = 0; let focusRuleFound=false; let cssInspected=0; const uiStructure:{routes:string[];components:string[];forms:number;ariaAttributes:number;themeTokens:string[];layoutFiles:string[]}={routes:[],components:[],forms:0,ariaAttributes:0,themeTokens:[],layoutFiles:[]};
  for (let i=0; i<count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP archive contains an invalid central directory record');
    const flags=buffer.readUInt16LE(offset+8), method=buffer.readUInt16LE(offset+10), expectedCrc=buffer.readUInt32LE(offset+16), compressed=buffer.readUInt32LE(offset+20), size=buffer.readUInt32LE(offset+24), nameLen=buffer.readUInt16LE(offset+28), extraLen=buffer.readUInt16LE(offset+30), commentLen=buffer.readUInt16LE(offset+32), local=buffer.readUInt32LE(offset+42);
    const name=buffer.subarray(offset+46,offset+46+nameLen).toString('utf8').replace(/\\/g,'/'); offset += 46+nameLen+extraLen+commentLen;
    if (name.endsWith('/') || ignoredPath.test(name) || !allowedCode.test(name) || name.startsWith('/') || name.split('/').includes('..')) continue;
    if ((flags & 1) !== 0 || ![0,8].includes(method)) continue;
    if (size > 2*1024*1024 || totalInflated + size > 50*1024*1024 || inspected >= 150) continue;
    if (local+30>buffer.length || buffer.readUInt32LE(local)!==0x04034b50) continue;
    const localName=buffer.readUInt16LE(local+26), localExtra=buffer.readUInt16LE(local+28), dataStart=local+30+localName+localExtra;
    if (dataStart+compressed>buffer.length) continue;
    const packed=buffer.subarray(dataStart,dataStart+compressed); let content: Buffer;
    try { content=method===0?Buffer.from(packed):zlib.inflateRawSync(packed,{maxOutputLength:2*1024*1024}); } catch { continue; }
    if(content.length!==size || crc32(content)!==expectedCrc) continue;
    totalInflated+=content.length; inspected++;
    const text=content.toString('utf8').replace(/\u0000/g,'').slice(0,100000);
    if(text.includes('\uFFFD')) continue;
    const route=name.match(/(?:^|\/)(?:pages?|routes?)\/(.+?)\.(?:tsx?|jsx?|html?)$/i)?.[1];
    const observations:string[]=[];
    if(/\.(?:css|scss)$/i.test(name)){cssInspected++;if(/:focus(?:-visible)?\b/i.test(text))focusRuleFound=true;uiStructure.layoutFiles.push(name);for(const token of text.matchAll(/--[\w-]+\s*:\s*[^;{}]+/g)){if(uiStructure.themeTokens.length<12)uiStructure.themeTokens.push(token[0].slice(0,100));}}
    if(/(?:^|\/)(?:pages?|routes?)\//i.test(name))uiStructure.routes.push(name);
    if(/\.(?:tsx|jsx|vue|svelte)$/i.test(name))uiStructure.components.push(name);
    uiStructure.forms+=(text.match(/<form\b/gi)||[]).length;uiStructure.ariaAttributes+=(text.match(/\baria-[\w-]+\s*=/gi)||[]).length;
    if(/<button\b(?![^>]*(?:aria-label|aria-labelledby))[^>]*>\s*<\/(?:button)>/i.test(text)) observations.push('Contains an empty button without an aria-label or aria-labelledby.');
    if(/<img\b(?![^>]*\balt\s*=)[^>]*>/i.test(text)) observations.push('Contains an image without an alt attribute.');
    if(/<(?:input|select|textarea)\b/i.test(text) && !/<label\b/i.test(text) && !/aria-label|aria-labelledby/i.test(text)) observations.push('Contains form controls but no label or accessible-name attributes were found in this file.');
    if(/loading|aria-busy/i.test(text)===false && /fetch\(|axios\.|useQuery\(/.test(text)) observations.push('Contains a data-loading pattern without a nearby loading-state indicator in this file.');
    if(/error|catch\s*\(/i.test(text)===false && /fetch\(|axios\./.test(text)) observations.push('Contains a network request pattern without an error handler in this file.');
    for(const [j,observed] of observations.entries()) evidence.push({id:`code-${inspected}-${j+1}`,source:'codebase',route:route?`/${route}`:'/',kind:/image|button|label/i.test(observed)?'accessibility':/focus/i.test(observed)?'focus':/loading/i.test(observed)?'loading':/error/i.test(observed)?'error':'ui',observed,excerpt:`Source file inspected: ${name}. File contents are withheld from the model summary.`});
    if(/package\.json$/i.test(name)) { try { const pkg=JSON.parse(text); evidence.push({id:`code-package-${inspected}`,source:'codebase',route:'/',kind:'project_metadata',observed:`Project metadata lists script names: ${Object.keys(pkg.scripts||{}).slice(0,20).join(', ')||'none'}.`,excerpt:JSON.stringify({name:pkg.name,scriptNames:Object.keys(pkg.scripts||{}).slice(0,20),dependencyNames:Object.keys(pkg.dependencies||{}).slice(0,35)}).slice(0,800)}); } catch { /* malformed metadata is not interpreted */ } }
  }
  if(cssInspected>0&&!focusRuleFound)evidence.push({id:'code-focus',source:'codebase',route:'/',kind:'focus',observed:'No focus or focus-visible rule was found across the inspected CSS stylesheets.'});
  evidence.push({id:'code-ui-structure',source:'codebase',route:'/',kind:'ui_structure',observed:`Inspected ${inspected} supported source/metadata files: ${uiStructure.routes.length} route-like files, ${uiStructure.components.length} component-like files, ${uiStructure.forms} form elements, ${uiStructure.ariaAttributes} ARIA attributes.`,excerpt:JSON.stringify({routes:uiStructure.routes.slice(0,20),components:uiStructure.components.slice(0,30),layoutFiles:uiStructure.layoutFiles.slice(0,20),themeTokens:uiStructure.themeTokens}).slice(0,2500)});
  if (!inspected) throw new Error('ZIP contained no readable supported source files');
  if (!evidence.length) evidence.push({id:'code-structure',source:'codebase',route:'/',kind:'project_structure',observed:`Read ${inspected} supported source and metadata files without executing project code. No deterministic accessibility or runtime-state issue was confirmed; feature suggestions must be reviewed as opportunities.`});
  return evidence.slice(0,100);
}
