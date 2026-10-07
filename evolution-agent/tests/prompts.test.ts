import { describe, it, expect } from 'vitest';
import { buildChoicePrompt, buildVerificationPrompt } from '../src/prompts/templates.js';
import { Candidate } from '../src/decision/schemas.js';

describe('Prompt Templates', () => {
  const dummyCandidates: Candidate[] = [
    { tag: 'button', id: 'submit-btn', text: 'Submit', visible: true, enabled: true, deterministicScore: 0, selector: '#submit-btn' },
    { tag: 'a', classes: ['link', 'btn'], text: 'Click Here', visible: true, enabled: true, deterministicScore: 0, selector: '.link.btn' }
  ];

  it('builds a choice prompt correctly', () => {
    const prompt = buildChoicePrompt('#old-btn', dummyCandidates, 'Submit');
    
    expect(prompt).toContain('Original selector: #old-btn');
    expect(prompt).toContain('Expected text/label: Submit');
    expect(prompt).toContain('0. <button id="submit-btn">Submit</button>');
    expect(prompt).toContain('1. <a class="link btn">Click Here</a>');
    expect(prompt).toContain('exactly 2 numbers');
    expect(prompt).toContain('"type": "choice"');
  });

  it('builds a choice prompt without expected text', () => {
    const prompt = buildChoicePrompt('#old-btn', dummyCandidates);
    expect(prompt).not.toContain('Expected text/label');
  });

  it('builds a verification prompt correctly', () => {
    const prompt = buildVerificationPrompt('#old-btn', dummyCandidates[0], 'Submit');
    
    expect(prompt).toContain('Original broken selector: #old-btn');
    expect(prompt).toContain('<button id="submit-btn">Submit</button>');
    expect(prompt).toContain('"type": "noul"');
  });
});
