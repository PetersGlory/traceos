import { parse } from "csv-parse/sync";
import { EvidenceItem, type EvidenceType } from "../schemas/investigation.js";

/**
 * Deterministic evidence extraction from structured CSV sources.
 */

/** Column-name → field mapping for a given CSV type. */
interface CsvFieldMap {
  type: EvidenceType;
}

/** Central registry so load-case knows how to interpret each CSV file. */
export const STRUCTURED_CSV_SPECS: Record<string, CsvFieldMap> = {
  "orders.csv": { type: "orders" },
  "payment_provider.csv": { type: "payment" },
  "bank_settlement.csv": { type: "bank" },
};

/**
 * Parse a CSV file's text into EvidenceItem[].
 */
export function extractStructuredCsv(
  fileName: string,
  csvText: string,
  fieldMap: CsvFieldMap,
): EvidenceItem[] {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  const items: EvidenceItem[] = [];

  for (let i = 0; i < records.length; i++) {
    const row = records[i];

    // Map known aliases to canonical keys (all values remain strings).
    const normalized: Record<string, string> = {};
    for (const canon of Object.keys(row)) {
      normalized[canon.trim()] = row[canon]?.trim() ?? "";
    }

    const num = (k: string): number | undefined => {
      const v = normalized[k];
      if (v === undefined || v === "") return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };

    const cs = (k: string): string | undefined => {
      const v = normalized[k];
      return v === undefined || v === "" ? undefined : v;
    };

    const parties = [cs("customer_id") ?? cs("customer"), cs("provider_id") ?? cs("payment_id")]
      .filter((p): p is string => Boolean(p));

    const refValue =
      cs("ref") ?? cs("txn_ref") ?? cs("transaction_ref") ?? cs("txn_id");
    const amountMinorValue =
      num("amount_kobo") ?? num("amount_minor") ?? num("amount") ?? undefined;
    const statusValue = cs("status") ?? cs("result") ?? cs("state");

    const statement = [
      refValue ?? cs("order_ref") ?? "(no ref)",
      parties[0] ? `for ${parties[0]}` : "",
      amountMinorValue !== undefined
        ? `${(amountMinorValue / 100).toLocaleString()} ${cs("currency") ?? ""}`.trim()
        : "",
      statusValue ? `(${statusValue})` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const item: EvidenceItem = {
      id: `${fileName}:${i + 2}`, // +1 header, +1 zero-index
      source: fileName,
      type: fieldMap.type,
      timestamp: cs("timestamp") ?? cs("date") ?? cs("time") ?? "",
      statement,
      ref: refValue,
      parties,
      amountMinor: amountMinorValue,
      status: statusValue,
      raw: JSON.stringify(row),
    };

    items.push(item);
  }

  return items;
}
