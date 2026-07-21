// bun scripts/catalog.ts [--batch N] [--force] [--reset] [--ocr] [--manifest <file>]
//
// Phase 0, step 2. Triage tells you a file exists; it does not tell you what is in it —
// `head` is only populated for text, so every PDF/DOCX reaches the clustering step blank.
// Catalog fixes that mechanically: extract text (cached by content hash), cut a snippet
// per file, and write fixed-size batch files for a model to label.
//
// This command NEVER contacts a model. The labeling tier is a documented Claude subagent
// fan-out over the batch files it writes — see skills/catalog/SKILL.md. Keeping the two
// apart is what makes re-labeling free of re-extraction, and lets the expensive half be
// retried without touching the cheap half.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, openSync, readSync, closeSync } from "node:fs";
import { INBOX, join, basename, existsSync } from "./lib/util";
import { takeFlag, takeValue } from "./lib/args";
import { renderProgress, endProgress } from "./lib/progress";
import { extractCached, ocrCached, extractedBody, extractedPath } from "./lib/extract";

const args = process.argv.slice(2);
const force = takeFlag(args, "--force");
const reset = takeFlag(args, "--reset");
const ocr = takeFlag(args, "--ocr");
const manifestPath = takeValue(args, "--manifest") ?? join(INBOX, "manifest.jsonl");
const batchSize = Number(takeValue(args, "--batch") ?? 100);

if (!Number.isInteger(batchSize) || batchSize < 1) {
  console.error(`--batch must be a positive integer`);
  process.exit(1);
}

const CATALOG = join(INBOX, "catalog.jsonl");
const IN_DIR = join(INBOX, "catalog", "in");
const OUT_DIR = join(INBOX, "catalog", "out");

/** Enough to classify a document; short enough that 100 of them fit one subagent's context. */
const SNIPPET_CHARS = 4000;

if (!existsSync(manifestPath)) {
  console.error(`No manifest: ${manifestPath}`);
  console.error(`Index the corpus first:   khb triage <path...>`);
  process.exit(1);
}

// Batch files are a per-run pairing: in/NNNN.jsonl is answered by out/NNNN.jsonl. Wiping
// in/ while labeled out/ files are still unmerged would silently throw away model work,
// so refuse — catalog.jsonl is the only durable place for labels.
const staleOut = existsSync(OUT_DIR) ? readdirSync(OUT_DIR).filter((f) => f.endsWith(".jsonl")) : [];
if (staleOut.length && !reset) {
  console.error(`${staleOut.length} unmerged label file(s) in ${OUT_DIR}`);
  console.error(`Fold them into the catalog first:   khb catalog-merge`);
  console.error(`Or discard them:                    khb catalog --reset`);
  process.exit(1);
}

type ManifestRow = {
  path: string;
  size: number;
  sha256: string;
  ext: string;
  kind: string;
  head: string;
  protected?: boolean;
};

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      console.warn(`  malformed line in ${basename(path)}, skipped`);
    }
  }
  return out;
}

const key = (path: string, sha256: string) => `${path} ${sha256}`;

const manifest = readJsonl<ManifestRow>(manifestPath);
const already = new Set(readJsonl<{ path: string; sha256: string }>(CATALOG).map((r) => key(r.path, r.sha256)));

let skippedKind = 0, skippedProtected = 0, skippedDone = 0;
const seen = new Set<string>();
const todo = manifest.filter((r) => {
  if (r.kind === "skip") return (skippedKind++, false);
  if (r.protected) return (skippedProtected++, false);
  if (!force && already.has(key(r.path, r.sha256))) return (skippedDone++, false);
  // Duplicate content only needs labeling once; catalog-merge keys on path+sha256 too.
  const k = key(r.path, r.sha256);
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

/** Bounded read — a corpus contains multi-MB csv/json we must not slurp to take 4KB off the top. */
function textSnippet(path: string): string {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(SNIPPET_CHARS * 4);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return clean(buf.subarray(0, n).toString("utf8"));
  } finally {
    closeSync(fd);
  }
}

function clean(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/[^\P{C}\n]/gu, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, SNIPPET_CHARS);
}

type SnippetRow = { path: string; sha256: string; ext: string; name: string; size: number; snippet: string };

const snippets: SnippetRow[] = [];
const scanned: ManifestRow[] = [];
let extracted = 0, cached = 0, failed = 0, unsupported = 0, ocrd = 0;

for (let i = 0; i < todo.length; i++) {
  const r = todo[i];
  renderProgress(i + 1, todo.length, `${basename(r.path)} [${r.kind}]`);

  let snippet = "";
  try {
    if (r.kind === "text") {
      snippet = textSnippet(r.path);
    } else {
      const hit = existsSync(extractedPath(r.sha256));
      let res = await extractCached(r.path, r.sha256, r.ext);
      // A scan has no text to find — only OCR reads it, and only if asked. Either way it
      // stays in the scanned bucket, never the failed one: the file is fine, the tool was
      // wrong, and conflating the two is what sent the last ingest hunting by hand.
      if (res.status === "scanned") {
        if (ocr) {
          renderProgress(i + 1, todo.length, `${basename(r.path)} [ocr ${res.pages}p]`);
          res = await ocrCached(r.path, r.sha256);
          if (res.status === "ok") ocrd++;
        }
        if (res.status !== "ok") {
          scanned.push(r);
          continue;
        }
      }
      if (res.status === "unsupported") {
        unsupported++;
        continue;
      }
      if (res.status !== "ok") {
        failed++;
        continue;
      }
      if (hit) cached++;
      else extracted++;
      snippet = clean(extractedBody(res.path));
    }
  } catch {
    failed++;
    continue;
  }
  if (!snippet) {
    failed++;
    continue;
  }
  snippets.push({ path: r.path, sha256: r.sha256, ext: r.ext, name: basename(r.path), size: r.size, snippet });
}
endProgress();

rmSync(IN_DIR, { recursive: true, force: true });
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(IN_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const batches: string[] = [];
for (let i = 0; i < snippets.length; i += batchSize) {
  const id = String(batches.length + 1).padStart(4, "0");
  const file = join(IN_DIR, `${id}.jsonl`);
  writeFileSync(file, snippets.slice(i, i + batchSize).map((s) => JSON.stringify(s)).join("\n") + "\n");
  batches.push(file);
}

console.log(`\nmanifest: ${manifestPath} (${manifest.length} row(s))`);
console.log(
  `  skipped: ${skippedKind} unsupported kind, ${skippedProtected} password-protected, ${skippedDone} already cataloged`,
);
console.log(
  `  extracted: ${extracted} new, ${cached} from cache${ocrd ? `, ${ocrd} by OCR` : ""}, ` +
    `${unsupported} unsupported, ${failed} failed`,
);

// Scans are not failures — they are readable, just not by a text extractor. Keep the list
// so the OCR pass is a re-run rather than a hunt.
if (scanned.length) {
  const list = join(INBOX, "scanned.jsonl");
  writeFileSync(list, scanned.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`\n  ${scanned.length} scanned PDF(s) — pages, but no text layer. Listed in ${list}`);
  console.log(`  To read them:  bun add @hyzyla/pdfium sharp tesseract.js && khb catalog --ocr`);
  console.log(`  (OCR is slower and noisier than real text — that is why it is opt-in.)`);
}

if (!batches.length) {
  console.log(`\nNothing to label. Re-run with --force to rebuild batches for already-cataloged files.`);
  process.exit(0);
}

console.log(`\nbatches: ${batches.length} file(s) of up to ${batchSize} in ${IN_DIR}`);
console.log(`  ${snippets.length} file(s) awaiting labels`);
console.log(`\nNext: label the batches — see skills/catalog/SKILL.md`);
console.log(`  one Agent(model: "haiku") call per batch file; each writes its own`);
console.log(`  ${join(OUT_DIR, "NNNN.jsonl")}, then: khb catalog-merge`);
