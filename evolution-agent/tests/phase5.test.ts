import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { analyzeEvidence, RecommendationSchema } from '../src/evolution/recommendations.js';
import { PatchPlanSchema, applyPatchPlan, patchDiff, rollbackPatch } from '../src/evolution/patching.js';

const originalRoot = process.env.EVOLUTION_PROJECT_ROOT;
afterEach(() => { if (originalRoot === undefined) delete process.env.EVOLUTION_PROJECT_ROOT; else process.env.EVOLUTION_PROJECT_ROOT = originalRoot; });

describe('Phase 5 evidence-grounded recommendations', () => {
  it('creates typed recommendations from observed findings and labels opportunities honestly', () => {
    const recommendations = analyzeEvidence([
      { id: 'aria-1', route: '/evolution', kind: 'aria', observed: 'Button has no accessible name', selector: '#save' },
      { id: 'feature-1', route: '/skills', kind: 'search', observed: 'Users scan 40 skill cards without a search control' },
    ]);
    expect(recommendations).toHaveLength(2);
    expect(RecommendationSchema.parse(recommendations[0]).category).toBe('QUICK_WIN');
    expect(recommendations[1].category).toBe('UX_IMPROVEMENT');
    expect(recommendations.every((item) => item.evidenceGrounded === true)).toBe(true);
  });
  it('rejects recommendations without evidence grounding', () => {
    expect(() => RecommendationSchema.parse({ id: crypto.randomUUID(), category: 'QUICK_WIN', title: 'Generic idea', description: 'No evidence', evidenceIds: [], affectedRoute: '/', expectedBenefit: 'x', risk: 'LOW', confidence: 0.5, implementationPlan: ['x'], status: 'PROPOSED', evidenceGrounded: false })).toThrow();
  });
});

describe('Phase 5 controlled patching', () => {
  it('creates a diff, applies a preconditioned patch, and rolls it back', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evoloop-phase5-'));
    process.env.EVOLUTION_PROJECT_ROOT = root;
    const file = path.join(root, 'safe.txt'); fs.writeFileSync(file, 'before\n', 'utf8');
    const plan = PatchPlanSchema.parse({ recommendationId: crypto.randomUUID(), operations: [{ file: 'safe.txt', expectedText: 'before', replacementText: 'after' }] });
    expect(patchDiff(plan)).toContain('-before');
    const applied = applyPatchPlan(plan); expect(fs.readFileSync(file, 'utf8')).toBe('after\n');
    rollbackPatch(applied.backups); expect(fs.readFileSync(file, 'utf8')).toBe('before\n');
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('rejects secrets, absolute paths, and path traversal', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evoloop-phase5-safe-')); process.env.EVOLUTION_PROJECT_ROOT = root;
    fs.writeFileSync(path.join(root, 'safe.txt'), 'x', 'utf8');
    const id = crypto.randomUUID();
    expect(() => applyPatchPlan({ recommendationId: id, operations: [{ file: '../outside.txt', expectedText: 'x', replacementText: 'y' }] })).toThrow();
    expect(() => applyPatchPlan({ recommendationId: id, operations: [{ file: '.env', expectedText: 'x', replacementText: 'y' }] })).toThrow();
    fs.rmSync(root, { recursive: true, force: true });
  });
});
