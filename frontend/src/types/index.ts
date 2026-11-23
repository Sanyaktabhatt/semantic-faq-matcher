import { z } from 'zod';

export const faqSchema = z.object({
  faq_id: z.string(), category: z.string(), question: z.string(), answer: z.string(),
});
export type FAQ = z.infer<typeof faqSchema>;
const datasetSchema = z.object({
  key: z.string(), name: z.string(), filename: z.string(), labeled: z.boolean(),
  available: z.boolean(), count: z.number(),
});
export const metadataSchema = z.object({
  model: z.string(), faq_count: z.number(), phrasing_count: z.number().optional(), learned_count: z.number().optional(),
  high_confidence: z.number().optional(), ambiguity_margin: z.number().optional(),
  scoring_mode: z.string().optional(), bm25_saturation: z.number().optional(),
  categories: z.array(z.object({ name: z.string(), count: z.number() })),
  default_threshold: z.number(), semantic_weight: z.number(), keyword_weight: z.number(),
  dataset_sha256: z.string(), datasets: z.array(datasetSchema),
  dataset: z.object({ key: z.string(), label: z.string(), license: z.string().nullable(), source: z.string().nullable(), file: z.string() }).optional(),
});
export type Metadata = z.infer<typeof metadataSchema>;
export const matchSchema = z.object({
  status: z.enum(['Match found', 'No suitable match', 'Invalid query']),
  faq_id: z.string().nullable(), matched_question: z.string().nullable(),
  answer: z.string(), category: z.string().nullable(), similarity: z.number(),
  threshold: z.number(), elapsed_ms: z.number(),
  top_matches: z.array(faqSchema.extend({
    score: z.number(), semantic_similarity: z.number(), keyword_overlap: z.number(),
    matched_phrasing: z.string().nullable().optional(),
    phrasing_source: z.enum(['question', 'alternate', 'learned']).nullable().optional(),
    matched_terms: z.array(z.string()).optional(),
  })),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  ambiguous: z.boolean().optional(), margin: z.number().nullable().optional(),
  predicted_categories: z.array(z.object({ name: z.string(), score: z.number() })).optional(),
  category_filter: z.string().nullable().optional(), scoring_mode: z.string().optional(),
});
export type Match = z.infer<typeof matchSchema>;
export const evaluationSchema = z.object({
  threshold: z.number(), model: z.string(), measured_at: z.string(),
  duplicate_query_rows: z.number(), test_sha256: z.record(z.string(), z.string()),
  datasets: z.array(datasetSchema.extend({
    valid_count: z.number(), invalid_count: z.number(),
    top1_accuracy: z.number().nullable(), top3_accuracy: z.number().nullable(),
    accepted_accuracy: z.number().nullable(), rejection_rate: z.number().nullable(),
    false_accepts: z.number().nullable(),
  })),
  rows: z.array(z.object({
    dataset: z.string(), query: z.string(), expected_faq_id: z.string().nullable(),
    valid_label: z.boolean(), candidates: z.array(z.string()), score: z.number(),
    predicted_faq_id: z.string().nullable(), top1_correct: z.boolean().nullable(),
    top3_correct: z.boolean().nullable(), correct: z.boolean().nullable(),
  })),
  threshold_sweep: z.array(z.object({
    threshold: z.number(), correct_match_rate: z.number().nullable(),
    rejection_rate: z.number().nullable(),
  })),
});
export type Evaluation = z.infer<typeof evaluationSchema>;
export type Remote<T> =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; data: T }
  | { kind: 'error'; message: string };

export const feedbackSchema = z.object({ learned: z.boolean(), phrasing_count: z.number(), learned_count: z.number() });
export type FeedbackResult = z.infer<typeof feedbackSchema>;
const pairSchema = z.object({ similarity: z.number(), a_id: z.string(), a_question: z.string(), b_id: z.string(), b_question: z.string(), same_category: z.boolean() });
export const insightsSchema = z.object({
  total_queries: z.number(), matched: z.number(), unmatched: z.number(),
  match_rate: z.number().nullable(), avg_latency_ms: z.number().nullable(), avg_score: z.number().nullable(),
  confidence: z.record(z.string(), z.number()), ambiguous: z.number(),
  categories: z.array(z.object({ name: z.string(), count: z.number() })),
  top_faqs: z.array(z.object({ faq_id: z.string(), category: z.string(), count: z.number() })),
  knowledge_gaps: z.array(z.object({ query: z.string(), score: z.number(), nearest_faq_id: z.string().nullable(), nearest_question: z.string().nullable(), at: z.string() })),
  recent: z.array(z.object({ query: z.string(), accepted: z.boolean(), faq_id: z.string().nullable(), score: z.number(), confidence: z.string(), at: z.string() })),
  feedback: z.object({ helpful: z.number(), not_helpful: z.number(), learned: z.number() }),
  confusable_pairs: z.array(pairSchema),
  learned_count: z.number(), learned: z.array(z.object({ faq_id: z.string(), query: z.string() })),
});
export type Insights = z.infer<typeof insightsSchema>;
export const mapSchema = z.object({
  points: z.array(z.object({ faq_id: z.string(), category: z.string(), question: z.string(), x: z.number(), y: z.number() })),
  explained_variance: z.number(),
});
export type SemanticMap = z.infer<typeof mapSchema>;
export const projectionSchema = z.object({ query: z.string(), x: z.number(), y: z.number(), top: z.array(z.object({ faq_id: z.string(), score: z.number() })) });
export type Projection = z.infer<typeof projectionSchema>;

const modeSetSchema = z.object({ key: z.string(), name: z.string(), labeled: z.boolean(), count: z.number(), top1: z.number().nullable(), top3: z.number().nullable(), accepted: z.number().nullable(), rejection: z.number().nullable() });
export const comparisonSchema = z.object({
  threshold: z.number(), default_mode: z.string(), category_count: z.number(),
  modes: z.array(z.object({ mode: z.string(), label: z.string(), default: z.boolean(), sets: z.array(modeSetSchema) })),
  categories: z.array(z.object({ key: z.string(), name: z.string(), count: z.number(), centroid_accuracy: z.number().nullable(), top_faq_accuracy: z.number().nullable() })),
});
export type Comparison = z.infer<typeof comparisonSchema>;
