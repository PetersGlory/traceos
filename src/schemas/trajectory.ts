import { z } from "zod";

/**
 * Trajectory logging schema.
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
});

export type Trajectory = z.infer<typeof Trajectory>;
