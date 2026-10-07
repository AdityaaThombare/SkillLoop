import { RepairRisk } from '../browser/registry.js';

export type RoutingDecision = 'EXECUTE' | 'VERIFY_WITH_SECONDARY' | 'ABSTAIN';
export interface SelectiveRoute { routingDecision: RoutingDecision; reason: string; risk: RepairRisk; calibratedConfidence: number | null; executeThreshold: number; verifyThreshold: number; }

export function verifyThreshold(): number {
  const configured = Number(process.env.EVOLUTION_VERIFY_MIN_CONFIDENCE ?? '0.55');
  return Number.isFinite(configured) && configured >= 0 && configured <= 1 ? configured : 0.55;
}

export function routeSelectiveDecision(risk: RepairRisk, calibratedConfidence: number | null, calibrationAvailable: boolean, executeThreshold: number, secondaryThreshold = verifyThreshold()): SelectiveRoute {
  const base = { risk, calibratedConfidence, executeThreshold, verifyThreshold: secondaryThreshold };
  if (!calibrationAvailable || calibratedConfidence === null || !Number.isFinite(calibratedConfidence)) return { ...base, routingDecision: 'ABSTAIN', reason: 'No fitted calibration is available; calibrated confidence is unknown' };
  if (risk !== 'LOW') return { ...base, routingDecision: 'ABSTAIN', reason: 'Non-low-risk actions remain human-gated in Phase 4' };
  if (calibratedConfidence >= executeThreshold) return { ...base, routingDecision: 'EXECUTE', reason: 'Calibrated confidence meets the low-risk execution threshold' };
  if (calibratedConfidence >= secondaryThreshold) return { ...base, routingDecision: 'VERIFY_WITH_SECONDARY', reason: 'Calibrated confidence is uncertain; request independent secondary verification' };
  return { ...base, routingDecision: 'ABSTAIN', reason: 'Calibrated confidence is below the verification threshold' };
}
