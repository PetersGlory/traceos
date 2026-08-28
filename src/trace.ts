import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Trajectory } from "./schemas/trajectory.js";

/**
 * Trajectory persistence.
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
