// bun scripts/catalog-merge.ts [--keep]
//
// Phase 0, step 4. Folds the labeled batch files (inbox/catalog/out/NNNN.jsonl, written
// by the Haiku subagent fan-out) into inbox/catalog.jsonl — the canonical, deduped facet
// table the main thread crunches into a bundle set.
//
// Mechanical, and deliberately forgiving: a model wrote the input, so malformed lines are
// warned about and dropped rather than fatal. Batches with no answer are reported as the
// retry worklist — reissuing them costs only the model call, never re-extraction, because
// the extracted text is already in the content-addressed cache.
import { readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { INBOX, join, existsSync } from "./lib/util";
import { takeFlag } from "./lib/args";

const args = process.argv.slice(2);
const keep = takeFlag(args, "--keep");

const CATALOG = join(INBOX, "catalog.jsonl");
const IN_DIR = join(INBOX, "catalog", "in");
const OUT_DIR = join(INBOX, "catalog", "out");

if (!existsSync(OUT_DIR)) {
  console.error(`No label files: ${OUT_DIR}`);
  console.error(`Build batches first:   khb catalog`);
  process.exit(1);
}

const batchIds = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => f.replace(/\.jsonl$/, "")).sort() : [];

const expected = batchIds(IN_DIR);
const answered = batchIds(OUT_DIR);

type Facet = {
  path: string;
  sha256: string;
  topic: string;
  doc_type: string;
  project: string;
  summary: string;
};

const key = (r: { path: string; sha256: string }) => `${r.path} ${r.sha256}`;

/** Existing catalog first, so a freshly labeled row for the same file wins. */
const merged = new Map<string, Facet>();
let carried = 0;
if (existsSync(CATALOG)) {
  for (const line of readFileSync(CATALOG, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Facet;
      merged.set(key(r), r);
      carried++;
    } catch {
      /* a previous run's own output; drop it silently rather than fail the merge */
    }
  }
}

let added = 0, replaced = 0, malformed = 0;
for (const id of answered) {
  const file = join(OUT_DIR, `${id}.jsonl`);
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let r: Facet;
    try {
      r = JSON.parse(line) as Facet;
    } catch {
      malformed++;
      continue;
    }
    if (!r.path || !r.sha256) {
      malformed++;
      continue;
    }
    const k = key(r);
    if (merged.has(k)) replaced++;
    else added++;
    merged.set(k, {
      path: r.path,
      sha256: r.sha256,
      topic: r.topic ?? "",
      doc_type: r.doc_type ?? "",
      project: r.project ?? "",
      summary: r.summary ?? "",
    });
  }
}

const rows = [...merged.values()].sort((a, b) => a.path.localeCompare(b.path));
writeFileSync(CATALOG, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));

if (!keep) rmSync(OUT_DIR, { recursive: true, force: true });

console.log(`catalog: ${CATALOG}`);
console.log(`  ${rows.length} row(s) — ${carried} carried, ${added} new, ${replaced} re-labeled`);
if (malformed) console.log(`  ${malformed} unusable line(s) dropped`);

// The topic histogram IS the input to the final crunch: a long tail here means the
// vocabulary drifted and needs collapsing into fewer, wider categories.
const byTopic = new Map<string, number>();
for (const r of rows) byTopic.set(r.topic || "(none)", (byTopic.get(r.topic || "(none)") ?? 0) + 1);
const sorted = [...byTopic.entries()].sort((a, b) => b[1] - a[1]);
console.log(`\ntopics: ${byTopic.size} distinct`);
for (const [t, n] of sorted.slice(0, 20)) console.log(`  ${String(n).padStart(5)}  ${t}`);
if (sorted.length > 20) console.log(`  ... ${sorted.length - 20} more`);

const missing = expected.filter((id) => !answered.includes(id));
if (missing.length) {
  console.log(`\n${missing.length} batch(es) never labeled — retry just these:`);
  for (const id of missing) console.log(`  ${join(IN_DIR, `${id}.jsonl`)}`);
  console.log(`  (no re-extraction: the text is already cached)`);
  process.exit(0);
}

console.log(`\nNext: collapse the topic tail into a small set of wide, bundle-sized categories,`);
console.log(`  propose them, then: khb new-bundle <name> "<scope>" && khb route`);
