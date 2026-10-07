import { Page } from 'playwright';
import { RegisteredTarget } from './registry.js';
export interface VerificationResult { attempted: boolean; passed: boolean; expected: string; error?: string; }
export async function verifyRegisteredPostcondition(page: Page, target: RegisteredTarget): Promise<VerificationResult> {
  const expected = target.repair?.expectedVisibleSelector;
  if (!expected) return { attempted: false, passed: false, expected: '', error: 'Target has no registered postcondition' };
  try { const locator = page.locator(expected).first(); await locator.waitFor({ state: 'visible', timeout: 1500 }); return { attempted: true, passed: true, expected }; }
  catch { return { attempted: true, passed: false, expected, error: 'Expected element did not become visible' }; }
}
