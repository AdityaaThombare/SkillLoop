import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { BrowserManager } from '../browser/manager.js';

export const PatchOperationSchema = z.object({
  file: z.string().min(1).max(500),
  expectedText: z.string().min(1).max(100000),
  replacementText: z.string().max(100000),
}).strict();
export const PatchPlanSchema = z.object({ recommendationId: z.string().uuid(), operations: z.array(PatchOperationSchema).min(1).max(10) }).strict();
export type PatchPlan = z.infer<typeof PatchPlanSchema>;

const forbiddenFile = /(^|[\\/])(?:\.env|.*secret.*|.*credential.*|.*password.*|schema\.sql$)/i;
const projectRoot = () => path.resolve(process.env.EVOLUTION_PROJECT_ROOT || path.resolve(process.cwd(), '..'));
const safePath = (file: string): string => {
  if (path.isAbsolute(file) || forbiddenFile.test(file)) throw new Error('Patch file is not an allowlisted project file');
  const root = projectRoot(); const resolved = path.resolve(root, file);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error('Patch path escapes the registered project root');
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error('Patch file does not exist inside the registered project');
  return resolved;
};

export function patchDiff(plan: PatchPlan): string {
  const parsed = PatchPlanSchema.parse(plan);
  return parsed.operations.map((operation) => `--- ${operation.file}\n+++ ${operation.file}\n@@\n-${operation.expectedText}\n+${operation.replacementText}`).join('\n');
}

export function applyPatchPlan(plan: PatchPlan): { patchId: string; diff: string; backups: Array<{ file: string; original: string; hash: string }> } {
  const parsed = PatchPlanSchema.parse(plan); const backups: Array<{ file: string; original: string; hash: string }> = [];
  const resolved = parsed.operations.map((operation) => ({ operation, absolute: safePath(operation.file) }));
  for (const { operation, absolute } of resolved) {
    const original = fs.readFileSync(absolute, 'utf8');
    if (!original.includes(operation.expectedText)) throw new Error(`Patch precondition failed for ${operation.file}`);
    if (operation.replacementText.includes('\u0000')) throw new Error('Patch replacement contains an invalid NUL character');
    backups.push({ file: operation.file, original, hash: crypto.createHash('sha256').update(original).digest('hex') });
  }
  for (const { operation, absolute } of resolved) fs.writeFileSync(absolute, fs.readFileSync(absolute, 'utf8').replace(operation.expectedText, operation.replacementText), 'utf8');
  return { patchId: crypto.randomUUID(), diff: patchDiff(parsed), backups };
}

export function rollbackPatch(backups: Array<{ file: string; original: string; hash: string }>): void {
  for (const backup of backups) fs.writeFileSync(safePath(backup.file), backup.original, 'utf8');
}

export function runFixedVerification(): { build: { passed: boolean; output: string }; tests: { passed: boolean; output: string } } {
  const root = path.resolve(projectRoot(), 'evolution-agent');
  const run = (script: string) => { try { const command = process.platform === 'win32' ? 'cmd.exe' : 'npm'; const args = process.platform === 'win32' ? ['/d', '/s', '/c', `npm run ${script}`] : ['run', script]; return { passed: true, output: execFileSync(command, args, { cwd: root, encoding: 'utf8', timeout: 120000, stdio: 'pipe', windowsHide: true }).slice(-12000) }; } catch (error) { const typed = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string }; const output = `${typed.message || 'verification command failed'}\n${typed.stdout?.toString() || ''}\n${typed.stderr?.toString() || ''}`; return { passed: false, output: output.slice(-12000) }; } };
  return { build: run('build'), tests: run('test') };
}

export async function verifyRoutePostcondition(route: string, selector?: string): Promise<{ passed: boolean; detail: string }> {
  const manager = new BrowserManager();
  try {
    const page = await manager.createPage(); const status = await manager.navigate(page, route);
    if (status >= 400) return { passed: false, detail: `HTTP ${status}` };
    if (!selector) return { passed: true, detail: `HTTP ${status}; route loaded` };
    const locator = page.locator(selector).first(); const count = await locator.count();
    return { passed: count === 1 && await locator.isVisible(), detail: `HTTP ${status}; selector ${selector} ${count === 1 ? 'resolved' : 'did not resolve uniquely'}` };
  } catch (error) { return { passed: false, detail: error instanceof Error ? error.message : 'Browser verification failed' }; }
  finally { await manager.close().catch(() => undefined); }
}
