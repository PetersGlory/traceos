import { z } from "zod";

/**
 * Trajectory logging schema.
 *
 * The per-system investigation is persisted so the eval runner can reload a
 * finished run (as an eval cache) without calling Gemini again.
 */

/** A single agent invocation: input -> output. */
export const TrajectoryStep = z.object({
  agent: z.string(),
  input: z.string(),
  retry: z.boolean(),
  output: z.unknown(),
});

export type TrajectoryStep = z.infer<typeof TrajectoryStep>;

/** Full trajectory for one system run on one case. */
export const Trajectory = z.object({
  caseId: z.string(),
  system: z.enum(["baseline", "agent"]),
  investigation: z.unknown(),
  steps: z.array(TrajectoryStep),
  // Agent-only: persisted so the full AgentRunResult can be reconstructed from
  // the cache without re-running the LLM.
  verification: z.unknown().optional(),
  adversarialReview: z.unknown().optional(),
  wasRetried: z.boolean().optional(),
});

export type Trajectory = z.infer<typeof Trajectory>;
