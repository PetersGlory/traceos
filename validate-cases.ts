import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GroundTruth } from "./src/schemas/investigation.js";
import {
  extractStructuredCsv,
  STRUCTURED_CSV_SPECS,
} from "./src/evidence/extract-structured.js";

const casesDir = "cases";
const dirs = readdirSync(casesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

let failures = 0;

for (const dir of dirs) {
  const gtPath = join(casesDir, dir, "ground_truth.json");
  const raw = JSON.parse(readFileSync(gtPath, "utf8"));
  const parsed = GroundTruth.parse(raw);
  if (parsed.case_id !== dir) {
    console.log(`  MISMATCH case_id: ${parsed.case_id} != ${dir}`);
    failures++;
  }

  for (const [file, spec] of Object.entries(STRUCTURED_CSV_SPECS)) {
    const path = join(casesDir, dir, file);
    if (!exists(path)) continue;
    const csv = readFileSync(path, "utf8");
    const items = extractStructuredCsv(file, csv, spec);
    const bad = items.filter(
      (i) => !i.timestamp || (i.amountMinor !== undefined && !Number.isInteger(i.amountMinor)),
    );
    if (bad.length) {
      console.log(`  [${dir}] ${file}: ${bad.length} item(s) with missing timestamp`);
      failures++;
    }
  }
  console.log(`OK ${dir} (${parsed.difficulty})`);
}

function exists(p: string): boolean {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}

console.log(failures === 0 ? "\nAll cases valid." : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
