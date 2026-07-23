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
import { read, join } from "../lib/util";
import { bundleForIngest, DEFAULT_BUNDLE } from "../lib/scaffold";
import { readLedger, writeLedger } from "../lib/ledger";
import { takeFlag } from "../lib/args";
import { ingestFolder } from "./folder";
import { ingestFiles } from "./files";
import { ingestWeb } from "./web";
import type { Options } from "./acquire";

export type Source =
  | { type: "folder"; path: string }
  | { type: "files"; paths: string[] }
  | { type: "web"; urls: string[] };

const argv = process.argv.slice(2);
const opts: Options = {
  force: takeFlag(argv, "--force"),
  // On by default: a corpus half-ingested because the expensive formats were opt-in is a
  // corpus you have to remember to come back to. The flags exist for the impatient run.
  ocr: !takeFlag(argv, "--skip-ocr"),
  audio: !takeFlag(argv, "--skip-audio"),
};
// No bundle named → `default`, created on the spot if the hub has none. Bytes always have
// somewhere to land; sorting them into real bundles is a later, cheaper decision (a concept
// is one file, and moving it is a `git mv`). Naming a bundle explicitly stays the norm.
const bundle = argv.find((a) => !a.startsWith("--")) ?? DEFAULT_BUNDLE;

const dir = bundleForIngest(bundle);
const cfg = parse(read(join(dir, "sources.yaml"))) as { sources?: Source[] } | null;
const sources = cfg?.sources ?? [];
if (!sources.length) {
  console.log(`${bundle}: no sources configured.`);
  console.log(`Declare them in bundles/${bundle}/sources.yaml, then re-run: khb ingest ${bundle}`);
  process.exit(0);
}

const entries = readLedger(dir);

for (const s of sources) {
  console.log(`[${s.type}]`);
  const rawDir = join(dir, "raw", s.type);
  if (s.type === "folder") await ingestFolder(s, rawDir, dir, entries, opts);
  else if (s.type === "files") await ingestFiles(s, rawDir, dir, entries, opts);
  else if (s.type === "web") await ingestWeb(s, rawDir, dir, entries, opts);
  else console.warn(`  '${(s as any).type}' has no scripted ingester — the agent pulls it via MCP/CLI (see skills/ingest/SKILL.md)`);
}

writeLedger(dir, entries, bundle);

const all = [...entries.values()];
const pending = all.filter((e) => !e.raw).length;
const uncurated = all.filter((e) => e.raw && !e.curated).length;
console.log(`\nledger: ${all.length} source(s) in log.md`);
if (pending) console.log(`  ${pending} with an empty 'raw' — not extracted; see the reasons above`);
console.log(`  ${uncurated} in raw/ but not yet cataloged (empty 'curated')`);
console.log(`Next: catalog ${bundle} — turn raw/ into concept docs (skills/catalog/SKILL.md).`);
