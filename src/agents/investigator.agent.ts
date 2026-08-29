import { generateStructured } from "../lib/llm.js";
import { evidenceBlock } from "../lib/prompt.js";
import { Investigation, type EvidenceItem } from "../schemas/investigation.js";

/**
 * Investigator agent.
 */

export interface InvestigatorInput {
  caseId: string;
  disputedCustomer: string;
  evidence: EvidenceItem[];
  feedback?: string;
}

export async function runInvestigator(
  input: InvestigatorInput,
): Promise<Investigation> {
  const prompt = [
    "You are the Investigator in a payment/order dispute review pipeline.",
    "Examine all evidence and produce your best structured verdict.",
    "",
    evidenceBlock(input.evidence, input.disputedCustomer),
    "",
    "The DISPUTED CUSTOMER's claim is what you are adjudicating.",
    "",
    "Return the Investigation object:",
    "- disputedCustomer: the disputed customer id",
    "- claimIsValid: true only if the disputed customer's claim checks out",
    "- verifiedCustomer: customer whose payment is actually verified successful",
    "- confidence: 0..1 fraction",
    "- conclusion: one clear verdict sentence",
    "- keyFinding: single most important finding",
    "- findings: 3-5 bullet findings",
    "- contradictions: human-readable conflicts (quote evidence ids, e.g. '[EVD-03]')",
    "- supportingEvidenceIds: evidence ids supporting your conclusion",
    "- unresolvedQuestions: open questions for the human reviewer",
    ...(input.feedback
      ? [
          "",
          "The Verifier rejected your previous attempt with this feedback —",
          "re-examine the evidence and revise your verdict to address it:",
          input.feedback,
        ]
      : []),
    "",
    "Judge ONLY from the evidence. Be precise about which transaction belongs",
    "to which customer.",
  ].join("\n");

  return generateStructured(Investigation, prompt);
}
