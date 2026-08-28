import { parse } from "csv-parse/sync";
import { EvidenceItem, type EvidenceType } from "../schemas/investigation.js";

/**
 * Deterministic evidence extraction from structured CSV sources.
 *
 * No LLM here — this is pure parsing. CSV rows map onto EvidenceItem directly,
 * normalizing column names down to the shared shape (ref, parties, amountMinor,
 * status, timestamp). `source` records which file this came from so the report
 * and eval can attribute evidence.
 */

/** Column-name → field mapping for a given CSV type. */
interface CsvFieldMap {
  type: EvidenceType;
  /** e.g. { ref: "transaction_ref", customer: "customer_id", ... } */
  columns: Record<string, keyof EvidenceItemExtract | "raw">;
}

type EvidenceItemExtract = Omit<EvidenceItem, "id" | "type" | "raw"> & {
  amountMinor?: number;
};

/** Central registry so load-case knows how to interpret each CSV file. */
export const STRUCTURED_CSV_SPECS: Record<string, CsvFieldMap> = {
  "orders.csv": {
    type: "orders",
    columns: {},
  },
  "payment_provider.csv": {
    type: "payment",
    columns: {},
  },
  "bank_settlement.csv": {
    type: "bank",
    columns: {},
  },
};

/**
 * Parse a CSV file's text into EvidenceItem[].
 *
 * Column names are read from the header row and matched flexibly:
 * normally we map by known-alias names, but to keep Phase 1 deterministic and
 * simple, each row's columns are surfaced onto a normalized field map.
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
    const normalized: Record<string, string | number | undefined> = {};

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

    const item: EvidenceItem = {
      id: `${fileName}:${i + 2}`, // +1 header, +1 zero-index
      source: fileName,
      type: fieldMap.type,
      timestamp: cs("timestamp") ?? cs("date") ?? cs("time") ?? "",
      ref: cs("ref") ?? cs("txn_ref") ?? cs("transaction_ref") ?? cs("txn_id"),
      parties,
      amountMinor: num(normalized.amount_kobo ?? normalized.amount_minor ?? normalized.amount) ?? undefined,
      status: cs("status") ?? cs("result") ?? cs("state"),
      raw: JSON.stringify(row),
    };

    items.push(item);
  }

  return items;
}
