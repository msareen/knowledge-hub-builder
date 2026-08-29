// khb doctor — one read-only report on the state of a hub.
//
// Every check here already existed, scattered across the preambles of commands that each
// knew one of them: cli.ts announces a move and a version drift, `khb upgrade` prints the
// `khb update` hint, `khb ingest` counts the uncurated rows on its way out, and the
// transcriber probe only ever spoke during a run that needed it. So the answer to "what
// state is this hub in?" was: run several commands that change things and read their
// margins. This command asks nothing of the hub but to look at it.
//
// It writes nothing. That is the point, and it is also the boundary: `doctor` reports and
// names the command that repairs, but never repairs. `khb lint` stays the structural
// validator — doctor counts and points at it rather than duplicating a rule.
import { HUB, BUNDLES, listBundles, read, join, existsSync } from "./lib/util";
import { readLedger } from "./lib/ledger";
import { staleLocations, hubVersion } from "./lib/upgrade";
import { diffSourcesYamlAll } from "./lib/schema";
import { transcriberStatus } from "./lib/extract";
import { version, MARKER, markerIn } from "./lib/paths";
import { listHubs, canonical } from "./lib/registry";
import { section, detail, totalElapsed } from "./lib/log";
import { rejectUnknownFlags } from "./lib/args";
import { readdirSync, statSync } from "node:fs";
import { relative } from "node:path";

rejectUnknownFlags(process.argv.slice(2), "khb doctor");

/** Findings are advisory: doctor's exit code reports whether it ran, not what it found. */
const findings: string[] = [];
const flag = (msg: string, fix?: string) => findings.push(fix ? `${msg}\n      fix: ${fix}` : msg);

console.log(`khb doctor → ${HUB}`);

// ---- Hub identity -----------------------------------------------------------------------
const marker = (() => {
  try {
    return JSON.parse(read(join(HUB, markerIn(HUB) ?? MARKER))) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
})();

section("Hub");
detail(`name          ${(marker.name as string) || "(unset — khb.json 'name')"}`);
detail(`description   ${(marker.description as string) || "(unset — khb.json 'description')"}`);

// Drift is normally self-healing: cli.ts refreshes a hub before any in-hub command, this one
// included, so a mismatch here means the refresh was suppressed rather than that it is due.
const stamped = hubVersion(HUB);
const installed = version();
detail(
  `khb version   ${stamped ?? "unstamped"}` +
    (stamped === installed ? ` (matches installed)` : ` — installed is ${installed}`),
);
if (stamped !== installed)
  flag(
    `hub is stamped ${stamped ?? "unstamped"} but khb is ${installed}; its contract docs may be a version behind.`,
    process.env.KHB_NO_AUTO_UPGRADE ? "unset KHB_NO_AUTO_UPGRADE, or run: khb upgrade" : "khb upgrade",
  );

// ---- Location and registry --------------------------------------------------------------
// A hub moved more than once before anyone repaired it carries every former home, and
// `khb update --path` rewrites them all in one pass — so say how many there are rather than
// showing the most recent and implying it is the only one.
const stale = staleLocations(HUB);
detail(
  `location      ${
    stale.length
      ? `moved from ${stale[stale.length - 1]}${stale.length > 1 ? ` (+${stale.length - 1} earlier)` : ""}`
      : "matches the marker"
  }`,
);
if (stale.length)
  flag(
    `this hub has moved; absolute paths recorded inside it still name ${stale.length > 1 ? "former locations" : "its former location"}.`,
    "khb update --path            (khb update --path --dry-run to preview)",
  );

const registered = listHubs().some((entry) => canonical(entry.path) === canonical(HUB));
detail(`registered    ${registered ? "yes" : "no — 'khb list' and 'khb go' will not offer it"}`);

// ---- sources.yaml schema ----------------------------------------------------------------
const schemaDiffs = diffSourcesYamlAll(HUB);
if (schemaDiffs.length) {
  const fields = schemaDiffs.reduce((total, diff) => total + diff.changes.length, 0);
  flag(
    `${fields} sources.yaml field(s) across ${schemaDiffs.length} bundle(s) predate the current schema.`,
    "khb update --schema          (khb update --schema --dry-run to preview)",
  );
}

// ---- Bundles ----------------------------------------------------------------------------
const RESERVED = ["index.md", "log.md", "refs.md"];

/** Concept docs: every .md in the bundle outside raw/ that is not a reserved filename. */
function conceptCount(dir: string): number {
  const walk = (current: string): string[] =>
    readdirSync(current).flatMap((entry: string) => {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) return entry === "raw" ? [] : walk(path);
      return [relative(dir, path).replaceAll("\\", "/")];
    });
  return walk(dir).filter(
    (file) => file.endsWith(".md") && !RESERVED.includes(file.split("/").pop()!),
  ).length;
}

const bundles = listBundles();
section(`Bundles (${bundles.length})`);

if (!bundles.length) {
  detail("none yet — khb new-bundle <name> \"scope\"");
} else {
  const summaries = bundles.map((bundle) => {
    const dir = join(BUNDLES, bundle);
    const ledger = readLedger(dir);
    const rawDir = join(dir, "raw");
    const rawFiles = existsSync(rawDir)
      ? (readdirSync(rawDir, { recursive: true }) as string[]).filter((file) => file.endsWith(".md"))
          .length
      : 0;
    const rows = [...ledger.values()];
    return {
      bundle,
      concepts: conceptCount(dir),
      rawFiles,
      rows: rows.length,
      // The catalog backlog in the ledger's own terms — "in raw/ but not yet distilled into
      // a concept doc" — so a row must have a raw file to be part of it. A row with neither
      // is *pending*, a different state with a different fix, and counting it in both would
      // overstate the work cataloging can actually pick up.
      backlog: rows.filter((row) => row.raw && !row.curated).length,
      pending: rows.filter((row) => !row.raw).length,
    };
  });

  const nameWidth = Math.max(6, ...summaries.map((summary) => summary.bundle.length));
  detail(`${"bundle".padEnd(nameWidth)}  concepts   raw/   rows   backlog   pending`);
  for (const summary of summaries)
    detail(
      `${summary.bundle.padEnd(nameWidth)}  ${String(summary.concepts).padStart(8)}   ` +
        `${String(summary.rawFiles).padStart(4)}   ${String(summary.rows).padStart(4)}   ` +
        `${String(summary.backlog).padStart(7)}   ${String(summary.pending).padStart(7)}`,
    );

  const backlog = summaries.reduce((total, summary) => total + summary.backlog, 0);
  const pending = summaries.reduce((total, summary) => total + summary.pending, 0);
  if (backlog)
    flag(
      `${backlog} row(s) in raw/ but not yet cataloged, across ` +
        `${summaries.filter((summary) => summary.backlog).length} bundle(s).`,
      "ask an agent to catalog the bundle (skills/catalog/SKILL.md)",
    );
  // An empty `raw` is a source khb saw and could not convert — a missing extractor, a
  // protected file, or a --skip flag. It is not a failed run, but it is work still owed.
  if (pending)
    flag(
      `${pending} source(s) acquired but not extracted (empty 'raw' in log.md).`,
      "khb ingest <bundle> — after installing whatever the row's reason names",
    );
}

// ---- Extraction -------------------------------------------------------------------------
section("Extraction");
detail("bundled       text, PDF, DOCX, ODT, XLSX, PPTX, OCR (images + scanned PDFs), captions");
const transcriber = await transcriberStatus();
detail(`transcriber   ${transcriber.detail}`);
if (!transcriber.ready)
  flag(`no transcriber is ready, so audio and video will pend.`, transcriber.fix);

// ---- Findings ---------------------------------------------------------------------------
section(findings.length ? `Findings (${findings.length})` : "Findings");
if (!findings.length) detail("none — nothing here needs attention.");
else for (const finding of findings) detail(`- ${finding}`);

section("Next");
detail("khb lint      structural and OKF validation (doctor does not duplicate it)");
console.log(`\ndoctor: ${findings.length} finding(s) across ${bundles.length} bundle(s) in ${totalElapsed()}`);
