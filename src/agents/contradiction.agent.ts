import { generateStructured } from "../lib/llm.js";
import { evidenceBlock } from "../lib/prompt.js";
import {
  ContradictionReview,
  type EvidenceItem,
  type Investigation,
} from "../schemas/investigation.js";

/**
 * Contradiction / adversarial review agent.
 */

export interface ContradictionInput {
  caseId: string;
  disputedCustomer: string;
  investigation: Investigation;
  evidence: EvidenceItem[];
}

export async function runContradictionReview(
  input: ContradictionInput,
): Promise<ContradictionReview> {
  const prompt = [
    "You are the Adversarial Reviewer in a payment/order dispute pipeline.",
    "Your job is to try to DISPROVE the investigator's conclusion.",
    "Cross-check every evidence source against every other source and against",
    "the investigator's claims. Be aggressive but fair — only report real",
    "contradictions you can substantiate from the evidence.",
    "",
    evidenceBlock(input.evidence, input.disputedCustomer),
    "",
    `INVESTIGATOR'S CONCLUSION:`,
    input.investigation.conclusion,
    `verifiedCustomer=${input.investigation.verifiedCustomer}`,
    `claimIsValid=${input.investigation.claimIsValid}`,
    `confidence=${input.investigation.confidence}`,
    `finding=${input.investigation.keyFinding}`,
    "",
    "Return the ContradictionReview:",
    "- contradictions: each { description, ref, claimedStatus, actualStatus }",
    "  where claimedStatus is what one source/investigator says and actualStatus",
    "  is what the cross-checked evidence shows. Empty array if the",
    "  investigator's conclusion survives your scrutiny.",
    "- notes: a short summary of whether you could or could not find grounds",
    "  to overturn the conclusion.",
  ].join("\n");

  return generateStructured(ContradictionReview, prompt);
}
