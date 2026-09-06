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
import { HUB, BUNDLES, listBundles, conceptFiles, rawFiles, read, join } from "./lib/util";
import { readLedger } from "./lib/ledger";
import { staleLocations, hubVersion } from "./lib/upgrade";
import { diffSourcesYamlAll } from "./lib/schema";
import { oneNoteStatus, transcriberStatus, optionalCliStatus } from "./lib/extract";
import { version, MARKER, markerIn, findHub } from "./lib/paths";
import { listHubs, canonical, loadConfig, agentFor, isAlive } from "./lib/registry";
import { checkConfig } from "./lib/config-check";
import { section, detail, totalElapsed } from "./lib/log";
import { rejectUnknownFlags } from "./lib/args";
import { paint } from "./lib/color";

rejectUnknownFlags(process.argv.slice(2), "khb doctor");

/** Findings are advisory: doctor's exit code reports whether it ran, not what it found. */
const findings: string[] = [];
const flag = (msg: string, fix?: string) =>
  findings.push(fix ? `${msg}\n      ${paint.dim("fix:")} ${paint.cmd(fix)}` : msg);

const hubFound = findHub();

console.log(`${paint.head("khb doctor")} → ${hubFound ? paint.path(HUB) : paint.dim(`no hub in ${process.cwd()}`)}`);

// ---- Hub identity -----------------------------------------------------------------------
section("Hub");
if (!hubFound) {
  detail(`none found in ${process.cwd()} or any parent directory.`);
  detail(`create one     ${paint.cmd("khb init <dir>")}`);
  detail(`or point at one   ${paint.cmd("khb --hub <dir> doctor")}   (or set $KHB_HUB)`);
} else {
  const marker = (() => {
    try {
      return JSON.parse(read(join(HUB, markerIn(HUB) ?? MARKER))) as Record<string, unknown>;
    } catch {
      return {} as Record<string, unknown>;
    }
  })();

  detail(`name          ${(marker.name as string) || "(unset — khb.json 'name')"}`);
  detail(`description   ${(marker.description as string) || "(unset — khb.json 'description')"}`);

  // Drift is normally self-healing: cli.ts refreshes a hub before any in-hub command, this
  // one included, so a mismatch here means the refresh was suppressed rather than due.
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
}

// ---- Machine config ---------------------------------------------------------------------
// Not about this hub — about the file that lists every hub on the machine and names the
// agent `khb go` launches. It belongs in doctor because it fails the same way a hub does:
// quietly. `loadConfig` ignores what it cannot read, so a hand edit that broke the JSON
// costs you every shortcut with no message anywhere. The rules live in lib/config-check.ts;
// doctor reports them and `khb config fix` is the half that writes.
section("Machine config");
const configReport = checkConfig();
detail(`file          ${configReport.path}`);
if (!configReport.exists) detail(`state         not written yet — created the first time khb registers a hub`);
else {
  const machineConfig = loadConfig();
  const agent = agentFor(machineConfig);
  detail(`agent         ${agent ? `${agent.name} (${agent.spec.command})` : "none — khb go prints the path"}`);
  const hubs = listHubs();
  const missing = hubs.filter((entry) => !isAlive(entry)).length;
  detail(`hubs          ${hubs.length} registered${missing ? `, ${missing} missing` : ""}`);
  detail(
    `schema        ${configReport.findings.length ? `${configReport.findings.length} finding(s)` : "clean"}`,
  );
}
for (const finding of configReport.findings) flag(`config: ${finding.what}`, finding.fix);

// ---- sources.yaml schema ----------------------------------------------------------------
if (hubFound) {
  const schemaDiffs = diffSourcesYamlAll(HUB);
  if (schemaDiffs.length) {
    const fields = schemaDiffs.reduce((total, diff) => total + diff.changes.length, 0);
    flag(
      `${fields} sources.yaml field(s) across ${schemaDiffs.length} bundle(s) predate the current schema.`,
      "khb update --schema          (khb update --schema --dry-run to preview)",
    );
  }
}

// ---- Bundles ----------------------------------------------------------------------------
const bundles = hubFound ? listBundles() : [];
section(`Bundles (${bundles.length})`);

if (!hubFound) {
  detail(`no hub — see above`);
} else if (!bundles.length) {
  detail(`none yet — ${paint.cmd('khb new-bundle <name> "scope"')}`);
} else {
  const summaries = bundles.map((bundle) => {
    const dir = join(BUNDLES, bundle);
    const ledger = readLedger(dir);
    const rows = [...ledger.values()];
    return {
      bundle,
      concepts: conceptFiles(dir).length,
      rawFiles: rawFiles(dir).length,
      rows: rows.length,
      // The catalog backlog in the ledger's own terms — "in raw/ but not yet distilled into
      // a concept doc" — so a row must have a raw file to be part of it. A row with neither
      // is *pending*, a different state with a different fix, and counting it in both would
      // overstate the work cataloging can actually pick up.
      backlog: rows.filter((row) => row.raw && !row.curated).length,
      pending: rows.filter((row) => !row.raw).length,
      // Why each unextracted row is unextracted. Page counts and byte sizes differ per file
      // and would shatter one cause into forty findings, so they collapse to `N` for the
      // tally — the per-row detail is in log.md, which is where you go to act on it.
      reasons: rows
        .filter((row) => !row.raw)
        .map((row) => (row.reason || "not recorded — re-run khb ingest").replace(/\d+/g, "N")),
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
      // Cataloging is the one thing khb points at that costs money, so the fix names the
      // command that says how much before it names the pass that spends it.
      "khb estimate            then ask an agent to catalog (skills/catalog/SKILL.md)",
    );
  // An empty `raw` is a source khb saw and could not convert — a missing extractor, a
  // protected file, or a --skip flag. It is not a failed run, but it is work still owed, and
  // the three causes have three different remedies. Naming them is the difference between a
  // number you can act on and one you can only feel bad about.
  if (pending) {
    const tally = new Map<string, number>();
    for (const summary of summaries)
      for (const reason of summary.reasons) tally.set(reason, (tally.get(reason) ?? 0) + 1);
    const ranked = [...tally].sort(([, a], [, b]) => b - a);
    const shown = ranked.slice(0, 6);
    const rest = ranked.slice(6).reduce((total, [, count]) => total + count, 0);
    flag(
      `${pending} source(s) acquired but not extracted (empty 'raw' in log.md):\n` +
        shown.map(([reason, count]) => `        ${String(count).padStart(5)}  ${reason}`).join("\n") +
        (rest ? `\n        ${String(rest).padStart(5)}  ${paint.dim(`across ${ranked.length - 6} other reason(s)`)}` : ""),
      "khb ingest <bundle> — after fixing what the reason names; log.md has the per-file detail",
    );
  }
}

// ---- Extraction -------------------------------------------------------------------------
section("Extraction");
detail("bundled       text, PDF, DOCX, ODT, XLSX, PPTX, OCR (images + scanned PDFs), captions");
const transcriber = await transcriberStatus();
detail(`transcriber   ${transcriber.detail}`);
if (!transcriber.ready)
  flag(`no transcriber is ready, so audio and video will pend.`, transcriber.fix);

// Reported, but deliberately not a finding when it is absent. Recordings turn up in most
// corpora; `.one` sections turn up in few, and flagging a python package on every hub that
// will never see one is noise. A hub that does hold them says so through the pending-row
// finding above, which carries this same fix in the row's own reason.
const onenote = await oneNoteStatus();
detail(`onenote       ${onenote.detail}`);
if (onenote.fix) detail(`              ${paint.cmd(onenote.fix)}`);

// Same reasoning as onenote above: these are a bonus second pass behind library readers that
// already cover ordinary files, so a missing one is worth naming but not worth a finding —
// it only ever matters for the odd file neither built-in route can parse.
for (const tool of await optionalCliStatus()) {
  detail(`${tool.tool.padEnd(13)} ${tool.detail}`);
  if (!tool.ready) detail(`              ${paint.cmd(tool.fix)}`);
}

// ---- Findings ---------------------------------------------------------------------------
section(findings.length ? `Findings (${findings.length})` : "Findings");
if (!findings.length) detail(paint.ok("none — nothing here needs attention."));
else for (const finding of findings) detail(`${paint.warn("-")} ${finding}`);

section("Next");
detail(`${paint.cmd("khb lint")}      structural and OKF validation (doctor does not duplicate it)`);
console.log(
  `\n${paint.head("doctor")}: ${findings.length ? paint.warn(`${findings.length} finding(s)`) : paint.ok("no findings")} ` +
    `across ${bundles.length} bundle(s) in ${totalElapsed()}`,
);
