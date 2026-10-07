import { describe, expect, it } from 'vitest';
import { applyRepairPolicy } from '../src/decision/risk.js';

describe('repair risk policy', () => {
  it('executes LOW risk above threshold', () => { expect(applyRepairPolicy('LOW', 0.9, 0.8).action).toBe('EXECUTE'); });
  it('abstains on low confidence', () => { expect(applyRepairPolicy('LOW', 0.79, 0.8).action).toBe('ABSTAIN'); });
  it.each(['HIGH', 'CRITICAL', 'MEDIUM', 'READ_ONLY'] as const)('abstains for %s risk', (risk) => { expect(applyRepairPolicy(risk, 0.99, 0.8).action).toBe('ABSTAIN'); });
});
