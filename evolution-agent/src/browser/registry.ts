export interface ObservationTarget { id: string; route: string; selector: string; description: string; }
export type RepairRisk = 'READ_ONLY' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export interface RepairSpec {
  action: 'click';
  risk: RepairRisk;
  expectedRole?: string;
  expectedId?: string;
  expectedText?: string;
  expectedAriaLabel?: string;
  expectedTag?: string;
  expectedVisibleSelector: string;
  allowedCandidateTags: readonly string[];
}
export interface RegisteredTarget extends ObservationTarget { repair?: RepairSpec; }
export const TARGETS: readonly RegisteredTarget[] = [
  { id: 'botFab', route: '/', selector: '#botFab', description: 'SkillLoop assistant button', repair: { action: 'click', risk: 'LOW', expectedRole: 'button', expectedId: 'botFab', expectedText: 'Open assistant', expectedAriaLabel: 'Open assistant', expectedTag: 'button', expectedVisibleSelector: '#botBox.open', allowedCandidateTags: ['button'] } },
  { id: 'evolutionPage', route: '/evolution', selector: '#runDecision', description: 'Evolution sample decision button' },
];
export function getTarget(id: string): RegisteredTarget | undefined { return TARGETS.find((target) => target.id === id); }
