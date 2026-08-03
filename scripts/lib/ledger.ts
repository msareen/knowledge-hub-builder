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
\`fetched\` and \`raw\`; the agent fills \`curated\` while cataloging (skills/catalog/SKILL.md).

Empty \`raw\` = seen but not extracted (protected, unreadable, or skipped by a flag).
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

/** A ledger row acquired from a local file, as opposed to a URL or a tool query. */
const isLocalSource = (s: string) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(s);

export type Identity =
  | { kind: "moved"; from: Entry }        // same bytes, old path gone — one file, renamed
  | { kind: "copy"; twin: Entry }         // same bytes, old path still there — two files
  | { kind: "ambiguous"; twins: Entry[] } // several rows share these bytes; do not guess
  | { kind: "new" };

/**
 * Decide what a not-yet-seen source path actually *is*, by content hash.
 *
 * Keying the ledger on the path alone means moving a file reads as a deletion plus an
 * unrelated arrival: a second raw/ file with identical bytes, a second row with an empty
 * `curated`, and so a second concept for material already cataloged. The bytes are the
 * identity; the path is just where they happen to live today.
 *
 * Only local-file rows are candidates — a URL cannot have been "moved" on this disk — and
 * a row is only a move if its old path is genuinely gone. Two live paths with the same
 * bytes are a copy, which is a real (if redundant) second source and the agent's call, not
 * ours. Several candidates at once is ambiguous, and guessing there would silently rewire
 * provenance, so we report and leave it alone.
 */
export function identify(entries: Map<string, Entry>, bundleDir: string, source: string, hash: string): Identity {
  if (entries.has(source)) return { kind: "new" }; // known path: freshness, not identity
  const twins = [...entries.values()].filter(
    (e) =>
      e.source !== source &&
      isLocalSource(e.source) &&
      e.sha256.startsWith(hash.slice(0, 12)) &&
      !!e.raw &&
      existsSync(join(bundleDir, e.raw)),
  );
  if (!twins.length) return { kind: "new" };
  const orphaned = twins.filter((e) => !existsSync(e.source));
  if (orphaned.length === 1) return { kind: "moved", from: orphaned[0] };
  if (orphaned.length > 1) return { kind: "ambiguous", twins: orphaned };
  return { kind: "copy", twin: twins[0] };
}

/**
 * Re-point an existing row at the file's new path, keeping its raw/ file and — the whole
 * point — its `curated` value, so cataloged material is not offered as backlog again.
 *
 * The raw/ filename deliberately does *not* change: concept docs cite raw paths in their
 * Citations sections, and renaming the file underneath them would break those links to
 * cosmetically match a path that is already recorded inside the file's own provenance
 * header. The header is what gets corrected.
 */
export function adopt(entries: Map<string, Entry>, from: Entry, source: string): Entry {
  entries.delete(from.source);
  const moved = { ...from, source };
  entries.set(source, moved);
  return moved;
}

export { HEADER as LEDGER_HEADER };
