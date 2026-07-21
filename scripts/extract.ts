// bun scripts/extract.ts [--force] [--ocr] [--manifest <file>]
//
// Pre-extract a triaged corpus: convert every readable file to markdown once, cached by
// content hash at inbox/extracted/<sha256>.md, and report what could not be read. `khb
// ingest` fills the same cache on demand, so this command is optional — its point is to
// find out what is unreadable BEFORE you commit a corpus to a bundle, and to do the slow
// conversions in one pass you can watch.
//
// This command NEVER contacts a model. It used to also cut snippets into batch files for a
// labeling fan-out that proposed a bundle set; that flow is gone. Bundles are decided after
// curation now, from real concept docs and their link graph — see `khb recatalog`.
import { readFileSync, writeFileSync } from "node:fs";
import { INBOX, join, basename, existsSync } from "./lib/util";
import { takeFlag, takeValue } from "./lib/args";
import { renderProgress, endProgress } from "./lib/progress";
import { extractCached, ocrCached, extractedPath, EXTRACTED } from "./lib/extract";

const args = process.argv.slice(2);
const force = takeFlag(args, "--force");
const ocr = takeFlag(args, "--ocr");
const manifestPath = takeValue(args, "--manifest") ?? join(INBOX, "manifest.jsonl");
if (!existsSync(manifestPath)) {
  console.error(`No manifest: ${manifestPath}`);
  console.error(`Index the corpus first:   khb triage <path...>`);
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

let skippedKind = 0, skippedProtected = 0, skippedText = 0;
const seen = new Set<string>();
const todo = manifest.filter((r) => {
  if (r.kind === "skip") return (skippedKind++, false);
  if (r.protected) return (skippedProtected++, false);
  if (r.kind === "text") return (skippedText++, false); // already markdown-readable
  // Extraction is keyed by content, so duplicates convert once.
  const k = key(r.path, r.sha256);
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const scanned: ManifestRow[] = [];
const failures: { path: string; reason: string }[] = [];
let extracted = 0, cached = 0, failed = 0, unsupported = 0, ocrd = 0;

for (let i = 0; i < todo.length; i++) {
  const r = todo[i];
  renderProgress(i + 1, todo.length, `${basename(r.path)} [${r.ext}]`);

  try {
    const hit = existsSync(extractedPath(r.sha256));
    if (hit && !force) {
      cached++;
      continue;
    }
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
      failures.push({ path: r.path, reason: "unsupported format" });
      continue;
    }
    if (res.status !== "ok") {
      failed++;
      failures.push({ path: r.path, reason: "extractor produced nothing usable" });
      continue;
    }
    extracted++;
  } catch (err) {
    failed++;
    failures.push({ path: r.path, reason: String(err) });
  }
}
endProgress();

console.log(`\nmanifest: ${manifestPath} (${manifest.length} row(s))`);
console.log(
  `  skipped: ${skippedKind} unreadable kind, ${skippedProtected} password-protected, ` +
    `${skippedText} already text`,
);
console.log(
  `  extracted: ${extracted} new, ${cached} already cached${ocrd ? `, ${ocrd} by OCR` : ""}, ` +
    `${unsupported} unsupported, ${failed} failed`,
);
console.log(`  cache: ${EXTRACTED}`);

if (failures.length) {
  const list = join(INBOX, "extract-errors.jsonl");
  writeFileSync(list, failures.map((f) => JSON.stringify(f)).join("\n") + "\n");
  console.log(`\n  ${failures.length} file(s) could not be read — listed in ${list}`);
  console.log(`  Decide now whether they matter; \`khb ingest\` will hit the same wall.`);
}

// Scans are not failures — they are readable, just not by a text extractor. Keep the list
// so the OCR pass is a re-run rather than a hunt.
if (scanned.length) {
  const list = join(INBOX, "scanned.jsonl");
  writeFileSync(list, scanned.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`\n  ${scanned.length} scanned PDF(s) — pages, but no text layer. Listed in ${list}`);
  console.log(`  To read them:  bun add @hyzyla/pdfium sharp tesseract.js && khb extract --ocr`);
  console.log(`  (OCR is slower and noisier than real text — that is why it is opt-in.)`);
}

console.log(`\nNext: khb ingest <bundle> — it copies out of this cache, so nothing converts twice.`);
