import { describe, expect, it, vi } from 'vitest';
import { executeRegisteredAction } from '../src/browser/executor.js';
import { verifyRegisteredPostcondition } from '../src/browser/verifier.js';
import { getTarget } from '../src/browser/registry.js';
import { RankedCandidate } from '../src/browser/ranker.js';
import { Page } from 'playwright';

function fakePage(options: { count?: number; visible?: boolean; enabled?: boolean; postcondition?: boolean } = {}) {
  const locator = { count: vi.fn(async () => options.count ?? 1), isVisible: vi.fn(async () => options.visible ?? true), isEnabled: vi.fn(async () => options.enabled ?? true), click: vi.fn(async () => undefined), first: vi.fn(function (this: unknown) { return locator; }), waitFor: vi.fn(async () => { if (options.postcondition === false) throw new Error('not visible'); }) };
  return { locator: vi.fn(() => locator), _locator: locator } as unknown as Page & { _locator: typeof locator };
}
const candidate: RankedCandidate = { index: 0, selector: '[id="assistant-button"]', tagName: 'button', id: 'assistant-button', visible: true, enabled: true, deterministicScore: 0.9 };
const executePolicy = { risk: 'LOW' as const, action: 'EXECUTE' as const, reason: 'test', threshold: 0.8 };

describe('registered browser action and postcondition', () => {
  it('clicks only a visible, enabled registered button', async () => {
    const page = fakePage(); const result = await executeRegisteredAction(page, getTarget('botFab')!, candidate, executePolicy);
    expect(result).toMatchObject({ attempted: true, selector: candidate.selector });
    expect(page._locator.click).toHaveBeenCalledOnce();
  });
  it('rejects invisible or non-unique candidates', async () => {
    expect((await executeRegisteredAction(fakePage({ visible: false }), getTarget('botFab')!, candidate, executePolicy)).attempted).toBe(false);
    expect((await executeRegisteredAction(fakePage({ count: 2 }), getTarget('botFab')!, candidate, executePolicy)).attempted).toBe(false);
  });
  it('does not execute a candidate element outside the registered tag allowlist', async () => {
    const page = fakePage(); const result = await executeRegisteredAction(page, getTarget('botFab')!, { ...candidate, tagName: 'a' }, executePolicy);
    expect(result.attempted).toBe(false); expect(page._locator.click).not.toHaveBeenCalled();
  });
  it('checks the exact registered visible postcondition', async () => {
    const page = fakePage(); const result = await verifyRegisteredPostcondition(page, getTarget('botFab')!);
    expect(result).toMatchObject({ attempted: true, passed: true, expected: '#botBox.open' });
    expect(page.locator).toHaveBeenCalledWith('#botBox.open');
  });
  it('returns failure when the postcondition is absent', async () => {
    const result = await verifyRegisteredPostcondition(fakePage({ postcondition: false }), getTarget('botFab')!);
    expect(result.passed).toBe(false);
  });
});
