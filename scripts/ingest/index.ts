// bun scripts/ingest/index.ts <bundle> [--force] — run every source in the bundle's
// sources.yaml, maintaining the log.md ledger so re-runs are incremental.
// Only trivially-scriptable sources live here (folder, files, web). Confluence/ADO/
// audio/PDF: the agent uses MCP servers / CLI tools directly — conventions in skills/ingest/SKILL.md.
import { parse } from "yaml";
import { bundleDir, read, join } from "../lib/util";
import { readLedger, writeLedger } from "../lib/ledger";
import { ingestFolder } from "./folder";
import { ingestFiles } from "./files";
import { ingestWeb } from "./web";

export type Source =
  | { type: "folder"; path: string }
  | { type: "files"; paths: string[] }
  | { type: "web"; urls: string[] };

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const bundle = argv.find((a) => !a.startsWith("--"));
if (!bundle) { console.error("Usage: bkr ingest <bundle> [--force]"); process.exit(1); }

const dir = bundleDir(bundle);
const cfg = parse(read(join(dir, "sources.yaml"))) as { sources?: Source[] } | null;
const sources = cfg?.sources ?? [];
if (!sources.length) { console.log(`${bundle}: no sources configured in sources.yaml`); process.exit(0); }

const entries = readLedger(dir);

for (const s of sources) {
  console.log(`[${s.type}]`);
  const rawDir = join(dir, "raw", s.type);
  if (s.type === "folder") await ingestFolder(s, rawDir, dir, entries, force);
  else if (s.type === "files") await ingestFiles(s, rawDir, dir, entries, force);
  else if (s.type === "web") await ingestWeb(s, rawDir, dir, entries, force);
  else console.warn(`  '${(s as any).type}' is not scripted — agent ingests it via MCP/CLI (see skills/ingest/SKILL.md)`);
}

writeLedger(dir, entries, bundle);

const all = [...entries.values()];
const pendingExtract = all.filter((e) => !e.raw).length;
const uncurated = all.filter((e) => e.raw && !e.curated).length;
console.log(`\nledger: ${all.length} source(s) in log.md`);
if (pendingExtract) console.log(`  ${pendingExtract} awaiting extraction (empty 'raw' column)`);
console.log(`  ${uncurated} acquired but not yet curated (empty 'curated' column)`);
console.log(`Next: curate raw/ into concept docs, fill the 'curated' column, update index.md.`);
