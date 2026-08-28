import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Trajectory } from "./schemas/trajectory.js";

/**
 * Trajectory persistence + eval cache.
 *
 * The per-case/per-system trajectory files double as an evaluation cache: the
 * eval runner can reload them instead of calling Gemini again, which keeps
 * re-scoring runs free of API quota usage.
 */

export function writeTrajectory(
  trajectoriesDir: string,
  trajectory: Trajectory,
): void {
  mkdirSync(trajectoriesDir, { recursive: true });
  const file = join(
    trajectoriesDir,
    `${trajectory.caseId}.${trajectory.system}.json`,
  );
  writeFileSync(file, JSON.stringify(trajectory, null, 2), "utf8");
}

/** Path to the saved trajectory for a given case/system. */
export function trajectoryPath(
  trajectoriesDir: string,
  caseId: string,
  system: "baseline" | "agent",
): string {
  return join(trajectoriesDir, `${caseId}.${system}.json`);
}

/** Whether a saved trajectory already exists for a case/system. */
export function hasTrajectory(
  trajectoriesDir: string,
  caseId: string,
  system: "baseline" | "agent",
): boolean {
  return existsSync(trajectoryPath(trajectoriesDir, caseId, system));
}

/** Load a saved trajectory, or null if it does not exist / is invalid. */
export function readTrajectory(
  trajectoriesDir: string,
  caseId: string,
  system: "baseline" | "agent",
): Trajectory | null {
  const file = trajectoryPath(trajectoriesDir, caseId, system);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Trajectory;
  } catch {
    return null;
  }
}
