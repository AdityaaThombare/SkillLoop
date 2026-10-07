import { Page } from 'playwright';
import { RankedCandidate } from './ranker.js';
import { RegisteredTarget } from './registry.js';
import { PolicyResult } from '../decision/risk.js';

export async function executeRegisteredAction(page: Page, target: RegisteredTarget, candidate: RankedCandidate, policy: PolicyResult): Promise<{ attempted: boolean; selector?: string; error?: string }> {
  if (policy.action !== 'EXECUTE' || policy.risk !== 'LOW' || target.repair?.risk !== 'LOW') return { attempted: false, error: 'Risk policy did not authorize execution' };
  if (!target.repair || target.repair.action !== 'click') return { attempted: false, error: 'Target has no registered click action' };
  if (!target.repair.allowedCandidateTags.includes(candidate.tagName || '')) return { attempted: false, error: 'Candidate element type is not allowed for this target' };
  const locator = page.locator(candidate.selector).first();
  if (await locator.count() !== 1) return { attempted: false, error: 'Candidate selector must resolve to exactly one element' };
  if (!(await locator.isVisible())) return { attempted: false, error: 'Candidate is not visible' };
  if (!(await locator.isEnabled())) return { attempted: false, error: 'Candidate is disabled' };
  try { await locator.click({ timeout: Number(process.env.PLAYWRIGHT_TIMEOUT_MS || 10000) }); return { attempted: true, selector: candidate.selector }; }
  catch (error) { return { attempted: true, selector: candidate.selector, error: error instanceof Error ? error.message : 'Click failed' }; }
}
