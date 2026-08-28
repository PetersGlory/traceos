import { generateStructured } from "./lib/gemini.js";
import { evidenceBlock } from "./lib/prompt.js";
import { Investigation, type EvidenceItem } from "./schemas/investigation.js";

/**
 * Baseline system.
 */

export interface BaselineInput {
  caseId: string;
  disputedCustomer: string;
  evidence: EvidenceItem[];
}

export async function runBaseline(input: BaselineInput): Promise<Investigation> {
  const prompt = [
    "You are a payment/order dispute investigator. A customer has made a claim",
    "and you must determine, from the evidence alone, whether that claim is valid.",
    "",
    evidenceBlock(input.evidence, input.disputedCustomer),
    "",
    "The DISPUTED CUSTOMER is the one whose claim is being adjudicated.",
    "",
    "Decide and return the Investigation object:",
    "- disputedCustomer: the disputed customer id",
    "- claimIsValid: true only if the disputed customer's claim checks out against the evidence",
    "- verifiedCustomer: customer whose payment/order is actually verified successful",
    "  (equals disputedCustomer when their claim is valid)",
    "- confidence: 0..1 fraction (e.g. 0.96 for 96%)",
    "- conclusion: one clear verdict sentence",
    "- keyFinding: the single most important finding",
    "- findings: bullet supporting findings (3-5)",
    "- contradictions: human-readable strings describing conflicts between evidence",
    "  (quote evidence ids, e.g. '[EVD-03]')",
    "- supportingEvidenceIds: the evidence ids that support your conclusion",
    "- unresolvedQuestions: open questions for the human reviewer (empty if none)",
    "",
    "Judge ONLY from the evidence provided. Be precise about which transaction",
    "belongs to which customer. Do not guess beyond the evidence.",
  ].join("\n");

  return generateStructured(Investigation, prompt);
}
