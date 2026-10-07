import { describe, expect, it } from 'vitest';
import { applyTemperature, evaluateCalibration, fitAndEvaluateCalibration, fitTemperature } from '../src/decision/calibration.js';
import { routeSelectiveDecision } from '../src/decision/selective.js';
import { SecondaryVerificationSchema } from '../src/decision/verification.js';

describe('Phase 4 temperature scaling', () => {
  it('scales logits before softmax, retaining the argmax', () => {
    const raw = applyTemperature([4, 1], 1);
    const softened = applyTemperature([4, 1], 2);
    expect(raw[0]).toBeGreaterThan(softened[0]);
    expect(softened[0]).toBeGreaterThan(0.5);
  });
  it('fits only calibration samples and reports held-out validation metrics', () => {
    const train = [{ scores: [5, 0], actualClass: 0 }, { scores: [0, 5], actualClass: 1 }, { scores: [3, 0], actualClass: 0 }, { scores: [0, 3], actualClass: 1 }];
    const validation = [{ scores: [1, 0], actualClass: 0 }, { scores: [0, 1], actualClass: 1 }, { scores: [0, 1], actualClass: 0 }];
    const fit = fitAndEvaluateCalibration(train, validation);
    expect(fit.method).toBe('temperature_scaling');
    expect(fit.trainingSamples).toBe(train.length);
    expect(fit.validation.samples).toBe(validation.length);
    expect(fit.validation).toHaveProperty('ece');
    expect(fit.validation).toHaveProperty('brierScore');
    expect(fit.validation.reliability.length).toBeGreaterThan(0);
  });
  it('rejects evaluating on absent held-out data and invalid classes', () => {
    expect(() => fitAndEvaluateCalibration([{ scores: [1, 0], actualClass: 0 }, { scores: [0, 1], actualClass: 1 }], [])).toThrow(/validation/);
    expect(() => fitTemperature([{ scores: [1, 0], actualClass: 4 }, { scores: [0, 1], actualClass: 1 }])).toThrow(/outside/);
    expect(() => evaluateCalibration([], 1)).toThrow(/labeled/);
  });
});

describe('Phase 4 selective prediction and verification schema', () => {
  it('abstains without calibration and for non-low-risk actions', () => {
    expect(routeSelectiveDecision('LOW', null, false, 0.8).routingDecision).toBe('ABSTAIN');
    expect(routeSelectiveDecision('HIGH', 0.99, true, 0.8).routingDecision).toBe('ABSTAIN');
  });
  it('routes calibrated confidence to execution, secondary verification, or abstention', () => {
    expect(routeSelectiveDecision('LOW', 0.9, true, 0.8).routingDecision).toBe('EXECUTE');
    expect(routeSelectiveDecision('LOW', 0.65, true, 0.8, 0.55).routingDecision).toBe('VERIFY_WITH_SECONDARY');
    expect(routeSelectiveDecision('LOW', 0.4, true, 0.8, 0.55).routingDecision).toBe('ABSTAIN');
  });
  it('accepts only typed verifier responses and rejects malformed output', () => {
    expect(SecondaryVerificationSchema.parse({ verdict: 'AGREE', rationale: 'Evidence supports the candidate', concerns: [] }).verdict).toBe('AGREE');
    expect(SecondaryVerificationSchema.safeParse({ verdict: 'EXECUTE', rationale: '' }).success).toBe(false);
    expect(SecondaryVerificationSchema.safeParse({ verdict: 'DISAGREE', rationale: 'x', extra: true }).success).toBe(false);
  });
});
