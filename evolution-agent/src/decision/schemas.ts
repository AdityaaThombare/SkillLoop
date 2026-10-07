import { z } from 'zod';

/**
 * Valid decision primitive types
 */
export const DecisionTypeSchema = z.enum(['choice', 'score', 'noul']);
export type DecisionType = z.infer<typeof DecisionTypeSchema>;

/**
 * Risk classification levels
 */
export const RiskLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

/**
 * Autonomous action decisions
 */
export const ActionTypeSchema = z.enum(['execute', 'abstain', 'secondary', 'human']);
export type ActionType = z.infer<typeof ActionTypeSchema>;

/**
 * Ground truth outcome for benchmark evaluation
 */
export const GroundTruthSchema = z.object({
  expectedOutcome: z.enum(['repair', 'abstain', 'defect']),
  correctCandidate: z.string().optional(),
  allowedCandidates: z.array(z.string()).optional(),
});
export type GroundTruth = z.infer<typeof GroundTruthSchema>;

/**
 * Single DOM candidate extracted for self-healing
 */
export const CandidateSchema = z.object({
  selector: z.string().min(1),
  tag: z.string().min(1),
  role: z.string().optional(),
  text: z.string().optional(),
  ariaLabel: z.string().optional(),
  id: z.string().optional(),
  classes: z.array(z.string()).optional(),
  visible: z.boolean(),
  enabled: z.boolean(),
  deterministicScore: z.number().default(0),
});
export type Candidate = z.infer<typeof CandidateSchema>;

/**
 * Helper to compute argmax of an array of numbers
 */
export function computeArgmax(scores: number[]): number {
  if (scores.length === 0) return -1;
  let maxIdx = 0;
  let maxVal = scores[0];
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > maxVal) {
      maxVal = scores[i];
      maxIdx = i;
    }
  }
  return maxIdx;
}

/**
 * Base Choice Schema without effects
 */
export const ChoiceBaseSchema = z.object({
  type: z.literal('choice'),
  scores: z.array(z.number().finite()).min(2, 'Must have at least 2 candidate scores'),
  choice: z.number().int().nonnegative('Choice index must be a non-negative integer'),
  reasoning: z.string().optional(),
});

/**
 * Choice Output Schema with bounds validation
 */
export const ChoiceOutputSchema = ChoiceBaseSchema.superRefine((val, ctx) => {
  if (val.choice >= val.scores.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Choice index (${val.choice}) is out of bounds for scores array of length ${val.scores.length}`,
      path: ['choice'],
    });
  }
});
export type ChoiceOutput = z.infer<typeof ChoiceOutputSchema>;

/** Ollama constrained JSON Schema for Choice; candidateCount makes score length exact. */
export function choiceOllamaFormat(candidateCount?: number): Record<string, unknown> {
  const scores: Record<string, unknown> = { type: 'array', items: { type: 'number' }, minItems: candidateCount ?? 2 };
  if (candidateCount !== undefined) scores.maxItems = candidateCount;
  const choice: Record<string, unknown> = { type: 'integer', minimum: 0 };
  if (candidateCount !== undefined) choice.maximum = candidateCount - 1;
  return {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['choice'] },
      scores,
      choice,
      reasoning: { type: 'string' },
    },
    required: ['type', 'scores', 'choice'],
    additionalProperties: false,
  };
}

/**
 * Validates semantic agreement between model choice and argmax(scores)
 */
export function isChoiceArgmaxConsistent(output: ChoiceOutput): boolean {
  return output.choice === computeArgmax(output.scores);
}

/**
 * Score Output Schema (LLM raw response for 5-bin ordinal evaluation)
 */
export const ScoreOutputSchema = z.object({
  type: z.literal('score'),
  scores: z.array(z.number().finite()).length(5, 'Score output requires exactly 5 ordinal bin scores'),
  reasoning: z.string().optional(),
});
export type ScoreOutput = z.infer<typeof ScoreOutputSchema>;

/**
 * Noul Output Schema (LLM raw response for binary decision)
 */
export const NoulOutputSchema = z.object({
  type: z.literal('noul'),
  scores: z.object({
    yes: z.number().finite(),
    no: z.number().finite(),
  }),
  reasoning: z.string().optional(),
});
export type NoulOutput = z.infer<typeof NoulOutputSchema>;

/**
 * Discriminated union of all raw model outputs
 */
export const ModelDecisionOutputSchema = z.discriminatedUnion('type', [
  ChoiceBaseSchema,
  ScoreOutputSchema,
  NoulOutputSchema,
]);
export type ModelDecisionOutput = z.infer<typeof ModelDecisionOutputSchema>;

/**
 * Self-healing API Request Schema
 */
export const HealRequestSchema = z.object({
  url: z.string().url('Must provide a valid target URL'),
  selector: z.string().min(1, 'Selector must not be empty'),
  expectedText: z.string().optional(),
});
export type HealRequest = z.infer<typeof HealRequestSchema>;

/**
 * Self-healing API Response Schema
 */
export const HealResponseSchema = z.object({
  requestId: z.string().uuid(),
  action: ActionTypeSchema,
  originalSelector: z.string(),
  newSelector: z.string().optional(),
  rawConfidence: z.number().min(0).max(1),
  calibratedConfidence: z.number().min(0).max(1),
  entropy: z.number().min(0).optional(),
  margin: z.number().min(0).max(1).optional(),
  risk: RiskLevelSchema,
  secondaryInvoked: z.boolean(),
  verified: z.boolean(),
  verificationDetails: z
    .object({
      selectorResolves: z.boolean(),
      elementVisible: z.boolean(),
      semanticsMatch: z.boolean(),
      noConsoleErrors: z.boolean(),
    })
    .optional(),
  latencyMs: z.number().int().nonnegative(),
  tokensUsed: z.number().int().nonnegative().optional(),
});
export type HealResponse = z.infer<typeof HealResponseSchema>;
