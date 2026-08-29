// bun scripts/ingest/index.ts <bundle> [--force] [--skip-ocr] [--skip-audio]
//
// Ingest is ONE flat phase: get every declared source into bundles/<b>/raw/ as markdown,
// with provenance, as cheaply and as locally as possible. It converts; it never interprets.
// Whatever the text means is the catalog pass's problem (skills/catalog/SKILL.md).
//
// Everything mechanically convertible is converted here in one go — text, PDF, DOCX, ODT,
// XLSX, PPTX, images (OCR), audio and video (whisper) — because leaving half the corpus as
// "pending, agent please run a CLI" made ingest a multi-round negotiation rather than a
// step. Sources that need an authenticated API (Confluence, ADO, git hosts) stay with the
// agent via MCP/CLI, which is a plugin boundary, not a phase.
import { parse } from "yaml";
import { read, join, HUB } from "../lib/util";
import { detail, section, totalElapsed } from "../lib/log";
import { bundleForIngest, listBundles, DEFAULT_BUNDLE } from "../lib/scaffold";
import { readLedger, writeLedger } from "../lib/ledger";
import { takeFlag, rejectUnknownFlags } from "../lib/args";
import { paint, paintErr } from "../lib/color";
import { ingestFolder } from "./folder";
import { ingestFiles } from "./files";
import { ingestWeb } from "./web";
import type { Options } from "./acquire";

export type Source =
  | { type: "folder"; path: string; exclude?: string[] }
  | { type: "files"; paths: string[]; exclude?: string[] }
  | { type: "web"; urls: string[] };

const USAGE = "khb ingest [bundle] [--force] [--skip-ocr] [--skip-audio]";
const argv = process.argv.slice(2);
const opts: Options = {
  force: takeFlag(argv, "--force"),
  // On by default: a corpus half-ingested because the expensive formats were opt-in is a
  // corpus you have to remember to come back to. The flags exist for the impatient run.
  ocr: !takeFlag(argv, "--skip-ocr"),
  audio: !takeFlag(argv, "--skip-audio"),
};
rejectUnknownFlags(argv, USAGE);
const positional = argv;
if (positional.length > 1) {
  console.error(`Usage: ${paintErr.cmd(USAGE)}`);
  process.exit(1);
}
// No bundle named: which one owns the material is a human decision (AGENTS.md) and a CLI
// cannot ask, so it stops and shows what the hub has, leaving the choice to whoever is
// driving. The exception is a hub with nothing to choose between — no bundles at all, or
// only the landing bundle — where bytes go to `default` rather than the ingest failing.
let bundle = positional[0];
if (!bundle) {
  const have = listBundles();
  const onlyLanding = have.length === 1 && have[0] === DEFAULT_BUNDLE;
  if (have.length && !onlyLanding) {
    console.error(`Usage: ${paintErr.cmd(USAGE)}`);
    console.error(`\nBundles in this hub: ${have.map((name) => paintErr.name(name)).join(", ")}`);
    console.error(`Name the one that owns this material, or start a new one:`);
    console.error(`  ${paintErr.cmd('khb new-bundle <name> "<scope>"')}`);
    process.exit(1);
  }
  bundle = DEFAULT_BUNDLE;
}

const dir = bundleForIngest(bundle);
let cfg: unknown;
try {
  cfg = parse(read(join(dir, "sources.yaml")));
} catch (e) {
  console.error(`${bundle}: sources.yaml is not valid YAML: ${(e as Error).message}`);
  process.exit(1);
}
const declared =
  cfg && typeof cfg === "object" && "sources" in cfg
    ? (cfg as { sources?: unknown }).sources
    : undefined;
if (declared !== undefined && !Array.isArray(declared)) {
  console.error(`${bundle}: sources.yaml 'sources' must be a list`);
  process.exit(1);
}
const sources = (declared ?? []) as any[];
for (const [i, s] of sources.entries()) {
  const at = `sources.yaml sources[${i}]`;
  if (!s || typeof s !== "object" || typeof s.type !== "string") {
    console.error(`${bundle}: ${at} must be an object with a string 'type'`);
    process.exit(1);
  }
  if (s.type === "folder" && typeof s.path !== "string") {
    console.error(`${bundle}: ${at}.path must be a string`);
    process.exit(1);
  }
  for (const [type, field] of [["files", "paths"], ["web", "urls"]] as const) {
    if (s.type === type && (!Array.isArray(s[field]) || s[field].some((v: unknown) => typeof v !== "string"))) {
      console.error(`${bundle}: ${at}.${field} must be a list of strings`);
      process.exit(1);
    }
  }
  if (
    (s.type === "folder" || s.type === "files") &&
    s.exclude !== undefined &&
    (!Array.isArray(s.exclude) || s.exclude.some((v: unknown) => typeof v !== "string"))
  ) {
    console.error(`${bundle}: ${at}.exclude must be a list of strings`);
    process.exit(1);
  }
}
if (!sources.length) {
  console.log(`${paint.name(bundle)}: ${paint.warn("no sources configured")}.`);
  console.log(
    `Declare them in ${paint.path(`bundles/${bundle}/sources.yaml`)}, then re-run: ${paint.cmd(`khb ingest ${bundle}`)}`,
  );
  process.exit(0);
}

const entries = readLedger(dir);

// State the whole plan before doing any of it: which hub (a --hub/$KHB_HUB run can target a
// folder you did not expect), which bundle, and which of the expensive extractors are armed.
console.log(`${paint.head("khb ingest")} → bundle ${paint.name(`'${bundle}'`)}`);
detail(`hub:      ${HUB}`);
detail(`bundle:   ${dir}`);
detail(`sources:  ${sources.length} declared in bundles/${bundle}/sources.yaml`);
detail(`options:  ocr=${opts.ocr ? "on" : "off"}  audio=${opts.audio ? "on" : "off"}  force=${opts.force ? "on" : "off"}`);
detail(`ledger:   ${entries.size} existing row(s) in log.md`);

for (const [i, s] of sources.entries()) {
  const label =
    s.type === "folder" ? s.path
    : s.type === "files" ? `${s.paths.length} path(s)`
    : s.type === "web" ? `${s.urls.length} url(s)`
    : "";
  section(`[${i + 1}/${sources.length}] ${s.type}${label ? ` — ${label}` : ""} → bundles/${bundle}/raw/${s.type}/`);
  const rawDir = join(dir, "raw", s.type);
  if (s.type === "folder") await ingestFolder(s, rawDir, dir, entries, opts);
  else if (s.type === "files") await ingestFiles(s, rawDir, dir, entries, opts);
  else if (s.type === "web") await ingestWeb(s, rawDir, dir, entries, opts);
  else console.warn(
      paintErr.warn(
        `  '${(s as any).type}' has no scripted ingester — the agent pulls it via MCP/CLI (see skills/ingest/SKILL.md)`,
      ),
    );
}

writeLedger(dir, entries, bundle);

const all = [...entries.values()];
const pending = all.filter((e) => !e.raw).length;
const uncurated = all.filter((e) => e.raw && !e.curated).length;
console.log(`\n${paint.ok("done")} in ${totalElapsed()}`);
console.log(`ledger: ${all.length} source(s) in ${paint.path(join(dir, "log.md"))}`);
if (pending)
  console.log(`  ${paint.warn(String(pending))} with an empty 'raw' — not extracted; see the reasons above`);
console.log(`  ${uncurated ? paint.warn(String(uncurated)) : "0"} in raw/ but not yet cataloged (empty 'curated')`);
console.log(`Next: catalog ${paint.name(bundle)} — turn raw/ into concept docs (skills/catalog/SKILL.md).`);
