/**
 * Case-directory resolution.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

export function resolveCaseDir(casesDir: string, caseId: string): string | null {
  if (!caseId || caseId.includes("/") || caseId.includes("\\") || caseId.includes("..")) {
    return null;
  }
  const dir = join(casesDir, caseId);
  return existsSync(dir) ? dir : null;
}
