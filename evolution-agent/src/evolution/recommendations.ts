import { z } from 'zod';
import crypto from 'node:crypto';

export const RecommendationCategorySchema = z.enum(['QUICK_WIN', 'UX_IMPROVEMENT', 'FEATURE_OPPORTUNITY']);
export const RecommendationRiskSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const RecommendationStatusSchema = z.enum(['PROPOSED', 'APPROVED', 'REJECTED', 'PATCHED', 'VERIFIED', 'ROLLED_BACK', 'FAILED']);

export const RecommendationSchema = z.object({
  id: z.string().uuid(),
  category: RecommendationCategorySchema,
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().min(1).max(2000),
  evidenceIds: z.array(z.union([z.string(), z.number().int().nonnegative()])).min(1).max(50),
  affectedRoute: z.string().startsWith('/').max(500),
  expectedBenefit: z.string().trim().min(1).max(1000),
  risk: RecommendationRiskSchema,
  confidence: z.number().min(0).max(1),
  implementationPlan: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
  status: RecommendationStatusSchema.default('PROPOSED'),
  evidenceGrounded: z.literal(true),
}).strict();
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const EvidenceFindingSchema = z.object({
  id: z.union([z.string(), z.number().int().nonnegative()]),
  route: z.string().startsWith('/').max(500),
  kind: z.enum(['aria', 'focus', 'spacing', 'navigation', 'loading', 'error', 'search', 'onboarding', 'other']),
  observed: z.string().trim().min(1).max(1200),
  selector: z.string().max(500).optional(),
  attributes: z.record(z.string(), z.string()).optional(),
}).strict();
export type EvidenceFinding = z.infer<typeof EvidenceFindingSchema>;

export const RecommendationRequestSchema = z.object({ findings: z.array(EvidenceFindingSchema).min(1).max(100) }).strict();

const categoryFor = (kind: EvidenceFinding['kind']): Recommendation['category'] => {
  if (['aria', 'focus', 'loading', 'error', 'spacing'].includes(kind)) return 'QUICK_WIN';
  if (['navigation', 'search'].includes(kind)) return 'UX_IMPROVEMENT';
  return 'FEATURE_OPPORTUNITY';
};

/** Deterministic analyzer: recommendations are derived only from supplied application evidence. */
export function analyzeEvidence(findings: EvidenceFinding[]): Recommendation[] {
  return findings.map((finding) => {
    const category = categoryFor(finding.kind);
    const title = category === 'FEATURE_OPPORTUNITY' ? `Explore ${finding.kind} opportunity on ${finding.route}` : `Improve ${finding.kind} issue on ${finding.route}`;
    const description = category === 'FEATURE_OPPORTUNITY'
      ? `${finding.observed} This is a product opportunity for review, not a confirmed defect.`
      : finding.observed;
    const risk: Recommendation['risk'] = category === 'QUICK_WIN' ? 'LOW' : category === 'UX_IMPROVEMENT' ? 'MEDIUM' : 'HIGH';
    const recommendation = {
      id: crypto.randomUUID(), category, title, description, evidenceIds: [finding.id], affectedRoute: finding.route,
      expectedBenefit: category === 'FEATURE_OPPORTUNITY' ? 'Potentially improve user outcomes after product review' : `Address the observed ${finding.kind} evidence`,
      risk, confidence: category === 'FEATURE_OPPORTUNITY' ? 0.55 : 0.9,
      implementationPlan: [`Review the evidence at ${finding.selector || finding.route}`, 'Define an allowlisted file-level change', 'Run the fixed build, test, and browser verification checks'],
      status: 'PROPOSED' as const, evidenceGrounded: true as const,
    };
    return RecommendationSchema.parse(recommendation);
  });
}
