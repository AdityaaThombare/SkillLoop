import { Candidate } from '../decision/schemas.js';

/**
 * Generates the 'choice' prompt for candidate evaluation.
 */
export function buildChoicePrompt(
  originalSelector: string,
  candidates: Candidate[],
  expectedText?: string
): string {
  let prompt = `You are evaluating web UI elements for an automated self-healing system.
Given a broken CSS selector and a list of candidate replacement elements, assign a semantic relevance score to each candidate.
Higher scores mean the candidate is a better match for the intended element.

Original selector: ${originalSelector}\n`;

  if (expectedText) {
    prompt += `Expected text/label: ${expectedText}\n`;
  }

  prompt += `\nCandidates:\n`;
  
  candidates.forEach((c, i) => {
    let tag = `<${c.tag}`;
    if (c.id) tag += ` id="${c.id}"`;
    if (c.role) tag += ` role="${c.role}"`;
    if (c.classes && c.classes.length > 0) tag += ` class="${c.classes.join(' ')}"`;
    tag += `>`;
    
    let inner = c.text || '';
    let closeTag = `</${c.tag}>`;
    
    prompt += `${i}. ${tag}${inner}${closeTag}\n`;
  });

  prompt += `
Analyze the candidates and output ONLY a JSON object matching this schema:
{
  "type": "choice",
  "scores": [<score for candidate 0>, <score for candidate 1>, ...],
  "choice": <index of highest scoring candidate>,
  "reasoning": "brief explanation"
}

The "scores" array MUST contain exactly ${candidates.length} numbers (one for each candidate).
`;
  return prompt;
}

/**
 * Generates a simpler 'noul' verification prompt for a single candidate.
 */
export function buildVerificationPrompt(
  originalSelector: string,
  candidate: Candidate,
  expectedText?: string
): string {
  let prompt = `You are verifying a self-healing repair.
Original broken selector: ${originalSelector}
Proposed replacement candidate: 
`;

  let tag = `<${candidate.tag}`;
  if (candidate.id) tag += ` id="${candidate.id}"`;
  if (candidate.classes && candidate.classes.length > 0) tag += ` class="${candidate.classes.join(' ')}"`;
  tag += `>${candidate.text || ''}</${candidate.tag}>`;

  prompt += `${tag}\n`;
  if (expectedText) prompt += `Expected text/label: ${expectedText}\n`;

  prompt += `
Is this a semantically correct replacement? Output ONLY a JSON object matching this schema:
{
  "type": "noul",
  "scores": {
    "yes": <score for yes>,
    "no": <score for no>
  },
  "reasoning": "brief explanation"
}
`;
  return prompt;
}
