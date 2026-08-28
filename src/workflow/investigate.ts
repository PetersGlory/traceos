import { hasGeminiKey } from "../lib/gemini.js";
import type { LoadedCase } from "../data/load-case.js";
import type {
  ContradictionReview,
  EvidenceItem,
  Investigation,
  Verification,
} from "../schemas/investigation.js";
import { runInvestigator } from "../agents/investigator.agent.js";
import { runContradictionReview } from "../agents/contradiction.agent.js";
import { runVerifier } from "../agents/verifier.agent.js";
import { writeTrajectory } from "../trace.js";
import { runBaseline } from "../baseline.js";

export interface CaseContext {
  caseId: string;
  disputedCustomer: string;
  evidence: EvidenceItem[];
}

export interface AgentRunResult {
  investigation: Investigation;
  verification: Verification;
  adversarialReview: ContradictionReview;
  wasRetried: boolean;
  steps: { agent: string; input: string; output: unknown; retry: boolean }[];
}

/**
 * The full agent pipeline for one case:
 *   investigator -> contradiction review -> verifier
 * with exactly ONE retry of the investigator if the verifier rejects.
 */
export async function runAgentPipeline(
  ctx: CaseContext,
): Promise<AgentRunResult> {
  if (!hasGeminiKey()) {
    throw new Error(
      "GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.",
    );
  }

  const steps: AgentRunResult["steps"] = [];

  // First pass
  let investigation = await runInvestigator({
    caseId: ctx.caseId,
    disputedCustomer: ctx.disputedCustomer,
    evidence: ctx.evidence,
  });
  steps.push({ agent: "investigator", input: "initial", output: investigation, retry: false });

  const contradict = async (inv: Investigation) => {
    const review = await runContradictionReview({
      caseId: ctx.caseId,
      disputedCustomer: ctx.disputedCustomer,
      investigation: inv,
      evidence: ctx.evidence,
    });
    steps.push({ agent: "contradiction", input: JSON.stringify(inv), output: review, retry: false });
    return review;
  };

  const verify = async (inv: Investigation, review: ContradictionReview) => {
    const v = await runVerifier({
      caseId: ctx.caseId,
      disputedCustomer: ctx.disputedCustomer,
      investigation: inv,
      adversarialReview: review,
      evidence: ctx.evidence,
    });
    steps.push({ agent: "verifier", input: JSON.stringify({ inv, review }), output: v, retry: false });
    return v;
  };

  let adversarialReview = await contradict(investigation);
  let verification = await verify(investigation, adversarialReview);

  let wasRetried = false;
  if (!verification.approved) {
    // Exactly one retry of the investigator with the verifier's feedback.
    wasRetried = true;
    investigation = await runInvestigator({
      caseId: ctx.caseId,
      disputedCustomer: ctx.disputedCustomer,
      evidence: ctx.evidence,
      feedback: verification.feedback,
    });
    steps.push({ agent: "investigator", input: `feedback: ${verification.feedback}`, output: investigation, retry: true });

    adversarialReview = await contradict(investigation);
    steps.push({
      agent: "contradiction",
      input: JSON.stringify(investigation),
      output: adversarialReview,
      retry: true,
    });

    verification = await verify(investigation, adversarialReview);
    steps.push({
      agent: "verifier",
      input: JSON.stringify({ investigation, adversarialReview }),
      output: verification,
      retry: true,
    });
  }

  return { investigation, verification, adversarialReview, wasRetried, steps };
}

/**
 * Run both systems (baseline + agent) on a case and persist their trajectories.
 */
export async function investigateCase(
  loaded: LoadedCase,
  opts: { systems: Array<"baseline" | "agent">; trajectoriesDir: string },
): Promise<{
  baseline: Investigation | null;
  agent: AgentRunResult | null;
}> {
  const disputedCustomer = resolvedDisputedCustomer(loaded.evidence);

  const ctx: CaseContext = {
    caseId: loaded.caseId,
    disputedCustomer,
    evidence: loaded.evidence,
  };

  let baseline: Investigation | null = null;
  let agent: AgentRunResult | null = null;

  if (opts.systems.includes("baseline")) {
    baseline = await runBaseline(ctx);
    writeTrajectory(opts.trajectoriesDir, {
      caseId: loaded.caseId,
      system: "baseline",
      investigation: baseline,
      steps: [],
    });
  }

  if (opts.systems.includes("agent")) {
    agent = await runAgentPipeline(ctx);
    writeTrajectory(opts.trajectoriesDir, {
      caseId: loaded.caseId,
      system: "agent",
      investigation: agent.investigation,
      steps: agent.steps,
    });
  }

  return { baseline, agent };
}

/** Best-effort resolution of the disputed customer id from the evidence. */
export function resolvedDisputedCustomer(evidence: EvidenceItem[]): string {
  // The disputed customer is the one appearing in chat/receipt evidence, or the
  // party present across the most evidence items. Fall back to a placeholder.
  const counts = new Map<string, number>();
  for (const e of evidence) {
    for (const p of e.parties ?? []) {
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  let best = "";
  let bestCount = 0;
  for (const [p, c] of counts) {
    if (c > bestCount) {
      bestCount = c;
      best = p;
    }
  }
  return best || "UNKNOWN";
}
