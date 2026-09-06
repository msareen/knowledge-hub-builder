// log.md — the durable ingest ledger (OKF-reserved filename, so lint never treats it
// as a concept doc). Committed, unlike raw/, so it survives raw/ being deleted and
// re-derived. Columns: source | sha256 | fetched | raw | curated | reason.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type Entry = {
  source: string;   // canonical URI of the origin: absolute path, url, or tool query
  sha256: string;   // content hash — drives skip-unchanged and cross-bundle dedup
  fetched: string;  // ISO timestamp of last acquisition
  raw: string;      // bundle-relative raw/ path, or "" when extraction is still pending
  curated: string;  // concept doc(s) distilled from it, or "" when not yet curated
  // Why `raw` is empty — "password-protected", "image (--skip-ocr)", "no extractor for this
  // format". Empty on any row that did extract.
  //
  // It was only ever said out loud, on the console, during the run that decided it: a ledger
  // read a week later showed a blank `raw` and no way to tell a file khb cannot read from one
  // a flag skipped from one whose password the user has. Those have three different remedies
  // and the run that knew which is long gone, so the answer belongs in the file that outlives
  // it. khb owns this column outright and rewrites it every run — unlike `curated`.
  reason: string;
};

const HEADER = `# {{name}} — ingest log

Ingestion ledger, one row per source. \`khb ingest\` maintains \`source\`, \`sha256\`,
\`fetched\`, \`raw\` and \`reason\`; the agent fills \`curated\` while cataloging
(skills/catalog/SKILL.md).

Empty \`raw\` = seen but not extracted, and \`reason\` says why (protected, no extractor,
or skipped by a flag).
Empty \`curated\` = in raw/ but not yet distilled into a concept doc.

| source | sha256 | fetched | raw | curated | reason |
|---|---|---|---|---|---|
`;

const unwrap = (s: string) => s.trim().replace(/^`|`$/g, "").trim();
const wrap = (s: string) => (s ? `\`${s.replaceAll("|", "\\|")}\`` : "");

/**
 * One table cell's worth of explanation, applied at write time so every path that sets a
 * reason gets it. A failing extractor can hand back a whole stack trace, and a newline or a
 * pipe in a markdown table does not corrupt one row, it corrupts the table. The ledger
 * records *what* went wrong; the console output of the run that found out is the transcript.
 */
const REASON_MAX = 160;
const asReason = (text = "") => {
  const line = text.replace(/\s+/g, " ").replaceAll("|", "\\|").trim();
  return line.length > REASON_MAX ? `${line.slice(0, REASON_MAX - 1)}…` : line;
};

export function ledgerPath(bundleDir: string) {
  return join(bundleDir, "log.md");
}

/**
 * Parse log.md into entries keyed by source. Missing file = empty ledger.
 *
 * Five cells is the pre-`reason` table and still parses: a ledger written by an older khb
 * keeps every row, gains an empty reason, and picks one up the next time its source is
 * re-tried. There is no migration to run — `writeLedger` rewrites the whole table anyway.
 */
export function readLedger(bundleDir: string): Map<string, Entry> {
  const p = ledgerPath(bundleDir);
  const out = new Map<string, Entry>();
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map(unwrap);
    if (cells.length < 5) continue;
    if (cells[0] === "source" || /^-+$/.test(cells[0])) continue; // header / separator
    const [source, sha256, fetched, raw, curated, reason] = cells;
    out.set(source, { source, sha256, fetched, raw, curated, reason: reason ?? "" });
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
    .map(
      (e) =>
        `| ${wrap(e.source)} | ${wrap(e.sha256.slice(0, 12))} | ${e.fetched} | ${wrap(e.raw)} | ` +
        // Prose, not a path, so it is the one cell that is not backticked.
        `${wrap(e.curated)} | ${asReason(e.reason)} |`,
    );
  const table = ["", "| source | sha256 | fetched | raw | curated | reason |", "|---|---|---|---|---|---|", ...rows, ""];
  writeFileSync(p, preamble + "\n" + table.join("\n"));
}

/**
 * Upsert, preserving the agent-owned `curated` column. Returns the merged entry.
 *
 * `reason` is khb's and defaults to empty, so a successful extraction clears whatever the
 * last run recorded without every caller having to remember to. A file that was
 * password-protected in March and unlocked in April must not still read as protected.
 */
export function record(entries: Map<string, Entry>, e: Omit<Entry, "curated" | "reason"> & { reason?: string }): Entry {
  const merged = { ...e, reason: e.reason ?? "", curated: entries.get(e.source)?.curated ?? "" };
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
