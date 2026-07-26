// One local file → one raw/*.md, fully extracted.
//
// This is the whole of ingest's judgement: pick the extractor by file kind, run it, write
// the text with provenance. Every acquisition path (folder walk, explicit file list) funnels
// through here so a `.pdf` behaves identically however it was named, and so there is exactly
// one place that decides what "acquired" means.
//
// Nothing here interprets content. Ingest ends the moment bytes have become text — deciding
// what the text *says* is the catalog pass (skills/catalog/SKILL.md).
import { readFileSync, existsSync } from "node:fs";
import { writeRaw, sha256File, rawNameFor } from "../lib/util";
import { record, isFresh, type Entry } from "../lib/ledger";
import {
  extractCached, ocrCached, ocrImageCached, transcribeCached,
  extractedBody, extractedPath, type Extraction,
} from "../lib/extract";
import { kindOf, extOf, mdName } from "./exts";
import { detectPasswordProtected, PROTECTABLE } from "./protect";

export type Options = {
  force: boolean;   // re-acquire even when the content hash is unchanged
  ocr: boolean;     // OCR scanned PDFs and images (default on; ~seconds/page)
  audio: boolean;   // transcribe audio/video (default on; ~minutes/file)
};

export type Counters = {
  copied: number;       // text files, taken verbatim
  extracted: number;    // converted this run
  fromCache: number;    // converted by an earlier run or another bundle
  ocrd: number;
  transcribed: number;
  lowQuality: number;   // OCR/ASR output — worth re-reading from source during curation
  skipped: number;      // unchanged since last ingest
  // Everything that did not become a raw/ file — protected, unreadable, no extractor, or
  // skipped by a flag. One bucket, not one per cause: the per-file line above already gave
  // the reason, and splitting it into `pending` + `failed` only ever double-counted.
  pending: number;
};

export const newCounters = (): Counters => ({
  copied: 0, extracted: 0, fromCache: 0, ocrd: 0, transcribed: 0,
  lowQuality: 0, skipped: 0, pending: 0,
});

/** Record the source with an empty `raw` so the owed work survives this process. */
function pend(entries: Map<string, Entry>, path: string, hash: string, c: Counters, why: string) {
  record(entries, { source: path, sha256: hash, fetched: new Date().toISOString(), raw: "" });
  c.pending++;
  console.log(`  pending — ${why}: ${path}`);
}

export async function acquireFile(
  path: string,
  name: string,
  rawDir: string,
  bundleDir: string,
  entries: Map<string, Entry>,
  c: Counters,
  opts: Options,
): Promise<void> {
  const kind = kindOf(path);
  const hash = await sha256File(path);
  if (kind === "skip") {
    pend(entries, path, hash, c, "no extractor for this format");
    return;
  }
  if (!opts.force && isFresh(entries, bundleDir, path, hash)) {
    c.skipped++;
    return;
  }

  const file = rawNameFor(rawDir, mdName(name), path, entries.values());
  const stamp = (raw: string) => record(entries, { source: path, sha256: hash, fetched: new Date().toISOString(), raw });

  if (kind === "text") {
    stamp(writeRaw(rawDir, file, { source: path, sha256: hash.slice(0, 12), tool: "copy", quality: "high" }, readFileSync(path, "utf8")));
    c.copied++;
    return;
  }

  // A password-protected document defeats every extractor identically, and finding that out
  // costs a byte-level peek instead of a failed conversion. Say so rather than reporting a
  // mystery empty file — the remedy (supply the password, re-export) is the user's.
  const ext = extOf(path);
  if (PROTECTABLE.has(ext) && detectPasswordProtected(path, ext, Bun.file(path).size)) {
    pend(entries, path, hash, c, "password-protected");
    return;
  }

  const hit = existsSync(extractedPath(hash));
  let res: Extraction;

  if (kind === "doc") {
    res = await extractCached(path, hash, ext);
    // Pages but no text layer: the file is fine, the reader was wrong. OCR is the remedy,
    // and running it here is what keeps ingest a single pass instead of a hunt afterwards.
    if (res.status === "needs-ocr") {
      if (!opts.ocr) {
        pend(entries, path, hash, c, `scanned, ${res.pages}p (--skip-ocr)`);
        return;
      }
      console.log(`  ocr — scanned, ${res.pages}p: ${path}`);
      res = await ocrCached(path, hash);
      if (res.status === "ok") c.ocrd++;
    }
  } else if (kind === "image") {
    if (!opts.ocr) {
      pend(entries, path, hash, c, "image (--skip-ocr)");
      return;
    }
    res = await ocrImageCached(path, hash);
    if (res.status === "ok" && !hit) c.ocrd++;
  } else {
    if (!opts.audio) {
      pend(entries, path, hash, c, "audio/video (--skip-audio)");
      return;
    }
    console.log(`  transcribing: ${path}`);
    res = await transcribeCached(path, hash);
    if (res.status === "ok" && !hit) c.transcribed++;
  }

  if (res.status !== "ok") {
    pend(entries, path, hash, c, res.status === "unsupported" ? "no extractor for this format" : res.reason);
    return;
  }

  // Copy out of the hash-keyed cache rather than moving: raw/ stays derived and the cache
  // stays reusable by any other bundle that holds the same content.
  stamp(writeRaw(rawDir, file, { source: path, sha256: hash.slice(0, 12), tool: res.tool, quality: res.quality }, extractedBody(res.path)));
  if (hit) c.fromCache++;
  else if (kind === "doc") c.extracted++;
  if (res.quality === "low") c.lowQuality++;
}

export function report(c: Counters) {
  const line = (n: number, s: string) => (n ? console.log(`  ${n} ${s}`) : undefined);
  line(c.skipped, "unchanged, skipped");
  line(c.copied, "text file(s) copied");
  line(c.extracted, "extracted");
  line(c.fromCache, "reused from the extraction cache (inbox/extracted/)");
  line(c.ocrd, "read by OCR");
  line(c.transcribed, "transcribed");
  line(c.lowQuality, "marked `quality: low` — verify against the source when curating");
  line(c.pending, "not extracted (empty `raw` in log.md)");
}
