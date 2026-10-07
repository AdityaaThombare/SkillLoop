import { CandidateEvidence, CandidateEvidenceSchema } from './observer.js';
import { RepairSpec } from './registry.js';

const normalized = (value?: string) => (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function similarity(a?: string, b?: string): number {
  const left = normalized(a); const right = normalized(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const aTokens = new Set(left.split(' ')); const bTokens = new Set(right.split(' '));
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  return overlap ? (2 * overlap) / (aTokens.size + bTokens.size) : 0;
}

export interface RankedCandidate extends CandidateEvidence { index: number; deterministicScore: number; }
export function rankCandidates(candidates: CandidateEvidence[], spec: RepairSpec, maximum = 5): RankedCandidate[] {
  return candidates.map((candidate, sourceIndex) => {
    const id = similarity(candidate.id, spec.expectedId);
    const aria = similarity(candidate.ariaLabel, spec.expectedAriaLabel);
    const text = similarity(candidate.text, spec.expectedText);
    const role = Number(Boolean(spec.expectedRole && normalized(candidate.role || candidate.tagName) === normalized(spec.expectedRole)));
    const tag = Number(Boolean(spec.expectedTag && normalized(candidate.tagName) === normalized(spec.expectedTag)));
    const visibility = Number(candidate.visible);
    const enabled = Number(candidate.enabled !== false);
    const stability = Number(Boolean(candidate.id || candidate.ariaLabel || candidate.role));
    const score = 0.10 * id + 0.25 * aria + 0.25 * text + 0.10 * role + 0.10 * tag + 0.08 * visibility + 0.05 * enabled + 0.07 * stability;
    return { ...CandidateEvidenceSchema.parse(candidate), sourceIndex, deterministicScore: Number(score.toFixed(4)) };
  }).filter((candidate) => candidate.visible && candidate.enabled !== false)
    .sort((a, b) => b.deterministicScore - a.deterministicScore || a.sourceIndex - b.sourceIndex)
    .slice(0, maximum)
    .map(({ sourceIndex: _sourceIndex, ...candidate }, index) => ({ ...candidate, index }));
}
