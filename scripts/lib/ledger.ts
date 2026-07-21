// log.md — the durable ingest ledger (OKF-reserved filename, so lint never treats it
// as a concept doc). Committed, unlike raw/, so it survives raw/ being deleted and
// re-derived. Columns: source | sha256 | fetched | raw | curated.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type Entry = {
  source: string;   // canonical URI of the origin: absolute path, url, or tool query
  sha256: string;   // content hash — drives skip-unchanged and cross-bundle dedup
  fetched: string;  // ISO timestamp of last acquisition
  raw: string;      // bundle-relative raw/ path, or "" when extraction is still pending
  curated: string;  // concept doc(s) distilled from it, or "" when not yet curated
};

const HEADER = `# {{name}} — ingest log

Ingestion ledger, one row per source. \`khb ingest\` maintains \`source\`, \`sha256\`,
\`fetched\` and \`raw\`; the agent fills \`curated\` during phase 2 of skills/ingest/SKILL.md.

Empty \`raw\` = acquired-but-not-extracted (binary awaiting a CLI pass).
Empty \`curated\` = in raw/ but not yet distilled into a concept doc.

| source | sha256 | fetched | raw | curated |
|---|---|---|---|---|
`;

const unwrap = (s: string) => s.trim().replace(/^`|`$/g, "").trim();
const wrap = (s: string) => (s ? `\`${s.replaceAll("|", "\\|")}\`` : "");

export function ledgerPath(bundleDir: string) {
  return join(bundleDir, "log.md");
}

/** Parse log.md into entries keyed by source. Missing file = empty ledger. */
export function readLedger(bundleDir: string): Map<string, Entry> {
  const p = ledgerPath(bundleDir);
  const out = new Map<string, Entry>();
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map(unwrap);
    if (cells.length < 5) continue;
    if (cells[0] === "source" || /^-+$/.test(cells[0])) continue; // header / separator
    const [source, sha256, fetched, raw, curated] = cells;
    out.set(source, { source, sha256, fetched, raw, curated });
  }
  return out;
}

/** Rewrite log.md, preserving any prose above the table. */
export function writeLedger(bundleDir: string, entries: Map<string, Entry>, bundleName: string) {
  const p = ledgerPath(bundleDir);
  const existing = existsSync(p) ? readFileSync(p, "utf8") : HEADER.replaceAll("{{name}}", bundleName);
  const preamble = existing.split("\n").filter((l) => !l.startsWith("|")).join("\n").trimEnd();
  const rows = [...entries.values()]
    .sort((a, b) => a.source.localeCompare(b.source))
    .map((e) => `| ${wrap(e.source)} | ${wrap(e.sha256.slice(0, 12))} | ${e.fetched} | ${wrap(e.raw)} | ${wrap(e.curated)} |`);
  const table = ["", "| source | sha256 | fetched | raw | curated |", "|---|---|---|---|---|", ...rows, ""];
  writeFileSync(p, preamble + "\n" + table.join("\n"));
}

/**
 * Upsert, preserving the agent-owned `curated` column. Returns the merged entry.
 */
export function record(entries: Map<string, Entry>, e: Omit<Entry, "curated">): Entry {
  const merged = { ...e, curated: entries.get(e.source)?.curated ?? "" };
  entries.set(e.source, merged);
  return merged;
}

/**
 * True when this source is already acquired at this exact content hash and its raw/
 * file is still on disk — the skip condition for incremental re-ingest.
 */
export function isFresh(entries: Map<string, Entry>, bundleDir: string, source: string, hash: string) {
  const e = entries.get(source);
  return !!e && e.sha256.startsWith(hash.slice(0, 12)) && !!e.raw && existsSync(join(bundleDir, e.raw));
}

export { HEADER as LEDGER_HEADER };
