import { RepairRisk } from '../browser/registry.js';
export type PolicyAction = 'EXECUTE' | 'ABSTAIN';
export interface PolicyResult { risk: RepairRisk; action: PolicyAction; reason: string; threshold: number; }
export function minimumRepairConfidence(): number {
  const value = Number(process.env.EVOLUTION_REPAIR_MIN_CONFIDENCE ?? '0.80');
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.8;
}
export function applyRepairPolicy(risk: RepairRisk, rawConfidence: number, threshold = minimumRepairConfidence()): PolicyResult {
  if (risk !== 'LOW') return { risk, action: 'ABSTAIN', reason: 'Only registered low-risk UI actions are eligible for automatic execution', threshold };
  if (!Number.isFinite(rawConfidence) || rawConfidence < threshold) return { risk, action: 'ABSTAIN', reason: `Raw confidence is below the configured ${threshold.toFixed(2)} threshold`, threshold };
  return { risk, action: 'EXECUTE', reason: 'Registered low-risk action meets the raw confidence threshold', threshold };
}
