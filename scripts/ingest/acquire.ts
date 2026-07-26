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
import { item, note, outcome } from "../lib/log";

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
  // The path is already on this item's own line; say only why it stopped.
  outcome(`pending — ${why}`);
}

export async function acquireFile(
  at: string,
  path: string,
  name: string,
  rawDir: string,
  bundleDir: string,
  entries: Map<string, Entry>,
  c: Counters,
  opts: Options,
): Promise<void> {
  // Announce the file first: hashing a multi-GB binary and every extractor below can take
  // real time, and a run that printed only successes left the slow file unnamed.
  item(at, path);
  const kind = kindOf(path);
  const hash = await sha256File(path);
  if (kind === "skip") {
    pend(entries, path, hash, c, "no extractor for this format");
    return;
  }
  if (!opts.force && isFresh(entries, bundleDir, path, hash)) {
    c.skipped++;
    outcome("unchanged, skipped");
    return;
  }

  const file = rawNameFor(rawDir, mdName(name), path, entries.values());
  const stamp = (raw: string) => record(entries, { source: path, sha256: hash, fetched: new Date().toISOString(), raw });

  if (kind === "text") {
    const raw = writeRaw(rawDir, file, { source: path, sha256: hash.slice(0, 12), tool: "copy", quality: "high" }, readFileSync(path, "utf8"));
    stamp(raw);
    c.copied++;
    outcome(`copied → ${raw}`);
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
    note(hit ? `${ext.slice(1)} — reusing cached extraction` : `extracting ${ext.slice(1)} …`);
    res = await extractCached(path, hash, ext);
    // Pages but no text layer: the file is fine, the reader was wrong. OCR is the remedy,
    // and running it here is what keeps ingest a single pass instead of a hunt afterwards.
    if (res.status === "needs-ocr") {
      if (!opts.ocr) {
        pend(entries, path, hash, c, `scanned, ${res.pages}p (--skip-ocr)`);
        return;
      }
      note(`no text layer, ${res.pages}p — scanned, running OCR (seconds per page)`);
      res = await ocrCached(path, hash);
      if (res.status === "ok") c.ocrd++;
    }
  } else if (kind === "image") {
    if (!opts.ocr) {
      pend(entries, path, hash, c, "image (--skip-ocr)");
      return;
    }
    note(hit ? "image — reusing cached OCR" : "image — running OCR …");
    res = await ocrImageCached(path, hash);
    if (res.status === "ok" && !hit) c.ocrd++;
  } else {
    if (!opts.audio) {
      pend(entries, path, hash, c, "audio/video (--skip-audio)");
      return;
    }
    note(hit ? "audio/video — reusing cached transcript" : "transcribing with whisper (minutes per file) …");
    res = await transcribeCached(path, hash);
    if (res.status === "ok" && !hit) c.transcribed++;
  }

  if (res.status !== "ok") {
    pend(entries, path, hash, c, res.status === "unsupported" ? "no extractor for this format" : res.reason);
    return;
  }

  // Copy out of the hash-keyed cache rather than moving: raw/ stays derived and the cache
  // stays reusable by any other bundle that holds the same content.
  const raw = writeRaw(rawDir, file, { source: path, sha256: hash.slice(0, 12), tool: res.tool, quality: res.quality }, extractedBody(res.path));
  stamp(raw);
  if (hit) c.fromCache++;
  else if (kind === "doc") c.extracted++;
  if (res.quality === "low") c.lowQuality++;
  // Name the tool and the quality on the line: `quality: low` is the flag that tells
  // curation to re-read the original, and burying it in the file made it easy to miss.
  outcome(`${hit ? "cached" : "extracted"} → ${raw}  [${res.tool}, quality: ${res.quality}]`);
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
