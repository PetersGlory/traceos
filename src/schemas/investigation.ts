import { z } from "zod";

/**
 * Core TraceOS schemas.
 */

/** The kind of source an evidence item was extracted from. */
export const EvidenceType = z.enum([
  "orders", // orders.csv — order records
  "payment", // payment_provider.csv — payment gateway ledger
  "bank", // bank_settlement.csv — bank settlement records
  "receipt", // receipt.txt — free-text receipt
  "chat", // customer_chat.txt — free-text chat transcript
]);

export type EvidenceType = z.infer<typeof EvidenceType>;

/**
 * A single, schema-normalized piece of evidence.
 */
export const EvidenceItem = z.object({
  id: z.string(),
  source: z.string(),
  type: EvidenceType,
  timestamp: z.string(),
  statement: z.string(),
  ref: z.string().optional(),
  parties: z.array(z.string()).optional(),
  amountMinor: z.number().int().optional(),
  status: z.string().optional(),
  raw: z.string(),
});

export type EvidenceItem = z.infer<typeof EvidenceItem>;

/** A specific structured contradiction between two evidence items. */
export const Contradiction = z.object({
  description: z.string(),
  ref: z.string(),
  claimedStatus: z.string(),
  actualStatus: z.string(),
});

export type Contradiction = z.infer<typeof Contradiction>;

/** A single event in a case timeline, displayed by the HTML report. */
export const TimelineEvent = z.object({
  timestamp: z.string(),
  event: z.string(),
  evidenceId: z.string(),
  importance: z.enum(["high", "medium", "low"]),
});

export type TimelineEvent = z.infer<typeof TimelineEvent>;

/**
 * The structured output of the investigation pipeline (investigator agent) and
 * of the baseline.
 */
export const Investigation = z.object({
  caseId: z.string(),
  disputedCustomer: z.string(),
  claimIsValid: z.boolean(),
  verifiedCustomer: z.string(),
  confidence: z.number().min(0).max(1),
  conclusion: z.string(),
  keyFinding: z.string(),
  findings: z.array(z.string()),
  contradictions: z.array(z.string()),
  supportingEvidenceIds: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
});

export type Investigation = z.infer<typeof Investigation>;

export const ContradictionReview = z.object({
  contradictions: z.array(Contradiction),
  notes: z.string(),
});

export type ContradictionReview = z.infer<typeof ContradictionReview>;

type VerificationStructured = {
  approved: boolean;
  reasoning: string;
  feedback?: string;
  confidence: number;
  correctedConclusion?: string;
  unsupportedClaims: string[];
  missingEvidence: string[];
  contradictionErrors: string[];
};

/**
 * Output of the verifier agent: approve, or reject with structured objections.
 */
export const Verification: z.ZodType<VerificationStructured> = z
  .object({
    approved: z.boolean(),
    reasoning: z.string(),
    feedback: z.string().optional(),
    confidence: z.number().min(0).max(1),
    correctedConclusion: z.string().optional(),
    unsupportedClaims: z.array(z.string()),
    missingEvidence: z.array(z.string()),
    contradictionErrors: z.array(z.string()),
  })
  .describe("Verification");

export type Verification = z.infer<typeof Verification>;

/** Structured ground truth for a case — must map exactly onto Investigation fields. */
export const GroundTruth = z.object({
  case_id: z.string(),
  correct_verified_customer: z.string(),
  disputed_customer: z.string(),
  disputed_customer_claim_is_valid: z.boolean(),
  key_contradiction: z
    .object({
      claimed_ref: z.string().optional(),
      actual_status: z.string().optional(),
      real_successful_txn: z.string().optional(),
      real_successful_customer: z.string().optional(),
    })
    .optional(),
  difficulty: z.enum(["normal", "clean", "hard", "ambiguous"]),
  note: z.string().optional(),
});

export type GroundTruth = z.infer<typeof GroundTruth>;
