import { describe, expect, it } from 'vitest';
import { rankCandidates } from '../src/browser/ranker.js';
import { getTarget } from '../src/browser/registry.js';

describe('deterministic candidate ranking', () => {
  it('ranks the semantic assistant replacement above unrelated controls', () => {
    const target = getTarget('botFab')!;
    const ranked = rankCandidates([
      { selector: '[id="delete"]', id: 'delete', tagName: 'button', role: 'button', text: 'Delete account', visible: true, enabled: true },
      { selector: '[id="assistant-button"]', id: 'assistant-button', tagName: 'button', role: 'button', ariaLabel: 'Open assistant', text: 'Open Assistant', visible: true, enabled: true },
    ], target.repair!);
    expect(ranked[0].selector).toBe('[id="assistant-button"]');
    expect(ranked[0].deterministicScore).toBeGreaterThan(ranked[1].deterministicScore);
    expect(ranked.map((item) => item.index)).toEqual([0, 1]);
  });

  it('filters hidden and disabled candidates before selection', () => {
    const ranked = rankCandidates([
      { selector: '#hidden', tagName: 'button', visible: false, enabled: true },
      { selector: '#disabled', tagName: 'button', visible: true, enabled: false },
    ], getTarget('botFab')!.repair!);
    expect(ranked).toHaveLength(0);
  });
});
