import { generateStructured } from "../lib/gemini.js";
import { evidenceBlock } from "../lib/prompt.js";
import {
  Verification,
  type ContradictionReview,
  type EvidenceItem,
  type Investigation,
} from "../schemas/investigation.js";

/**
 * Verifier agent.
 */

export interface VerifierInput {
  caseId: string;
  disputedCustomer: string;
  investigation: Investigation;
  adversarialReview: ContradictionReview;
  evidence: EvidenceItem[];
}

export async function runVerifier(
  input: VerifierInput,
): Promise<Verification> {
  const prompt = [
    "You are the Verifier in a payment/order dispute pipeline.",
    "Your job is to independently check whether the investigator's conclusion",
    "is well-supported by the evidence, and whether the adversarial review",
    "found any valid grounds to overturn it.",
    "",
    evidenceBlock(input.evidence, input.disputedCustomer),
    "",
    `INVESTIGATOR'S CONCLUSION:`,
    input.investigation.conclusion,
    `verifiedCustomer=${input.investigation.verifiedCustomer}`,
    `claimIsValid=${input.investigation.claimIsValid}`,
    `confidence=${input.investigation.confidence}`,
    "",
    `ADVERSARIAL REVIEW:`,
    JSON.stringify(input.adversarialReview, null, 2),
    "",
    "Return the Verification object:",
    "- approved: true only if the conclusion is well-supported and no",
    "  substantive contradiction or missing evidence undermines it",
    "- reasoning: plain-language rationale",
    "- confidence: 0..1 fraction in your decision",
    "- correctedConclusion: ONLY when approved=false, a corrected verdict if you",
    "  can determine one; otherwise omit",
    "- unsupportedClaims: claims in the conclusion with no evidence backing",
    "- missingEvidence: evidence that should exist but is absent",
    "- contradictionErrors: unresolved contradictions that should change the verdict",
    "- feedback: concise actionable direction for the investigator retry",
    "",
    "Approve only when you are genuinely confident. If anything material is",
    "missing or contradictory, reject.",
  ].join("\n");

  return generateStructured(Verification, prompt);
}
