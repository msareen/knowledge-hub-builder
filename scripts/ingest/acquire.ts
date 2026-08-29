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
import { basename } from "node:path";
import { writeRaw, sha256, sha256File, rawNameFor, retargetRaw, normPath } from "../lib/util";
import { record, isFresh, identify, adopt, type Entry } from "../lib/ledger";
import {
  extractCached, ocrCached, ocrImageCached, transcribeCached,
  extractedBody, extractedPath, type Extraction,
} from "../lib/extract";
import { captionFor, kindOf, mediaFor, extOf, mdName } from "./exts";
import { detectPasswordProtected, PROTECTABLE } from "./protect";
import { item, note, outcome } from "../lib/log";

export type Options = {
  force: boolean;   // re-acquire even when the content hash is unchanged
  ocr: boolean;     // OCR scanned PDFs and images (default on; ~seconds/page)
  audio: boolean;   // transcribe audio/video (default on; ~minutes/file)
  // Every path this source will visit, normalized. Only the caption/media pairing reads it
  // — a sidecar may only be folded into a recording that is itself being acquired, or a
  // `files:` source naming just the `.vtt` would acquire nothing at all.
  scope?: ReadonlySet<string>;
};

/** Will this source reach that file? An unset scope has no opinion, so: yes. */
const willVisit = (opts: Options, path: string) => !opts.scope || opts.scope.has(normPath(path));

export type Counters = {
  copied: number;       // text files, taken verbatim
  extracted: number;    // converted this run
  fromCache: number;    // converted by an earlier run or another bundle
  ocrd: number;
  transcribed: number;
  captioned: number;    // read from a caption sidecar — the whisper run it saved
  lowQuality: number;   // OCR/ASR output — worth re-reading from source during curation
  skipped: number;      // unchanged since last ingest
  moved: number;        // same bytes at a new path — row re-pointed, nothing re-extracted
  // Everything that did not become a raw/ file — protected, unreadable, no extractor, or
  // skipped by a flag. One bucket, not one per cause: the per-file line above already gave
  // the reason, and splitting it into `pending` + `failed` only ever double-counted.
  pending: number;
};

export const newCounters = (): Counters => ({
  copied: 0, extracted: 0, fromCache: 0, ocrd: 0, transcribed: 0, captioned: 0,
  lowQuality: 0, skipped: 0, moved: 0, pending: 0,
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

  // A caption sidecar is not a source of its own: `talk.vtt` beside `talk.mp4` is that
  // recording's words, and the recording's row claims them below. Acquiring it here as well
  // would spend a second raw/ file, a second uncurated ledger row and eventually a second
  // concept on the same sentences. A caption with no recording beside it — or one whose
  // recording this source will not visit — is a source like any other and falls through.
  if (kind === "caption") {
    const media = mediaFor(path);
    if (media && willVisit(opts, media)) {
      outcome(`captions for ${basename(media)} — acquired with the recording`);
      return;
    }
  }

  // Identity of a captioned recording is the pair's, not the file's. Hashing the media
  // alone would let a corrected transcript sit next to an "unchanged, skipped" row forever.
  const captions = kind === "av" ? captionFor(path) : undefined;
  const own = await sha256File(path);
  const capHash = captions ? await sha256File(captions) : kind === "caption" ? own : undefined;
  const hash = captions ? sha256(`${own}:${capHash}`) : own;
  if (kind === "skip") {
    pend(entries, path, hash, c, "no extractor for this format");
    return;
  }
  // Identity before freshness. A file that moved is the row it already has: resolve that
  // first, or it reads as an unrelated arrival and earns a second raw/ file, a second row
  // with an empty `curated`, and eventually a second concept for material already written.
  let adopted: Entry | undefined;
  const id = identify(entries, bundleDir, path, hash);
  if (id.kind === "moved") {
    adopted = adopt(entries, id.from, path);
    retargetRaw(bundleDir, adopted.raw, path);
    c.moved++;
    outcome(`moved from ${id.from.source} — kept ${adopted.raw}${adopted.curated ? " and its catalog entry" : ""}`);
    if (!opts.force) return;
  } else if (id.kind === "copy") {
    note(`same bytes as ${id.twin.source}, which is also still on disk — ingesting as its own source`);
  } else if (id.kind === "ambiguous") {
    note(`same bytes as ${id.twins.length} rows whose sources have all gone — not guessing which one moved here`);
  }

  if (!opts.force && isFresh(entries, bundleDir, path, hash)) {
    c.skipped++;
    outcome("unchanged, skipped");
    return;
  }

  // A source keeps its raw/ filename for life. Deriving the name from the path again on
  // every run means a file that moved and *then* changed re-extracts under a new name,
  // stranding the old raw file with the concept's Citations still pointing at it. Only fall
  // back to a fresh name when this source has no raw file in this directory yet.
  const held = adopted ?? entries.get(path);
  const file =
    held?.raw?.startsWith(`raw/${basename(rawDir)}/`)
      ? basename(held.raw)
      : rawNameFor(rawDir, mdName(name), path, entries.values());
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

  // The extraction cache is keyed on the bytes that actually get converted, which for a
  // captioned recording is the sidecar — so the same captions beside a re-encoded copy of
  // the video, or ingested alone into another bundle, hit the same entry.
  const key = capHash ?? hash;
  const hit = existsSync(extractedPath(key));
  let res: Extraction;

  if (kind === "doc") {
    note(hit ? `${ext.slice(1)} — reusing cached extraction` : `extracting ${ext.slice(1)} …`);
    res = await extractCached(path, key, ext);
    // Pages but no text layer: the file is fine, the reader was wrong. OCR is the remedy,
    // and running it here is what keeps ingest a single pass instead of a hunt afterwards.
    if (res.status === "needs-ocr") {
      if (!opts.ocr) {
        pend(entries, path, hash, c, `scanned, ${res.pages}p (--skip-ocr)`);
        return;
      }
      note(`no text layer, ${res.pages}p — scanned, running OCR (seconds per page)`);
      res = await ocrCached(path, key);
      if (res.status === "ok") c.ocrd++;
    }
  } else if (kind === "image") {
    if (!opts.ocr) {
      pend(entries, path, hash, c, "image (--skip-ocr)");
      return;
    }
    note(hit ? "image — reusing cached OCR" : "image — running OCR …");
    res = await ocrImageCached(path, key);
    if (res.status === "ok" && !hit) c.ocrd++;
  } else if (kind === "caption" || captions) {
    // Ahead of the --skip-audio check on purpose: that flag exists to skip minutes of CPU
    // per file, and reading a sidecar costs none. A pair is acquired even on a fast run.
    const src = captions ?? path;
    note(hit ? "captions — reusing cached extraction" : `reading captions from ${basename(src)} …`);
    res = await extractCached(src, key, extOf(src));
    if (res.status === "ok" && captions) c.captioned++;
  } else {
    if (!opts.audio) {
      pend(entries, path, hash, c, "audio/video (--skip-audio)");
      return;
    }
    note(hit ? "audio/video — reusing cached transcript" : "no captions beside it — transcribing (minutes per file) …");
    res = await transcribeCached(path, key);
    if (res.status === "ok" && !hit) c.transcribed++;
  }

  if (res.status !== "ok") {
    pend(entries, path, hash, c, res.status === "unsupported" ? "no extractor for this format" : res.reason);
    return;
  }

  // Copy out of the hash-keyed cache rather than moving: raw/ stays derived and the cache
  // stays reusable by any other bundle that holds the same content.
  // Name the sidecar in the provenance header, not just in this run's output: the recording
  // is the source, but which file the words were read from is what a curator needs to know
  // when the transcript and the audio disagree.
  const tool = captions ? `${res.tool} (sidecar: ${basename(captions)})` : res.tool;
  const raw = writeRaw(rawDir, file, { source: path, sha256: hash.slice(0, 12), tool, quality: res.quality }, extractedBody(res.path));
  stamp(raw);
  if (hit) c.fromCache++;
  else if (kind === "doc" || kind === "caption") c.extracted++;
  if (res.quality === "low") c.lowQuality++;
  // Name the tool and the quality on the line: `quality: low` is the flag that tells
  // curation to re-read the original, and burying it in the file made it easy to miss.
  outcome(`${hit ? "cached" : "extracted"} → ${raw}  [${tool}, quality: ${res.quality}]`);
}

export function report(c: Counters) {
  const line = (n: number, s: string) => (n ? console.log(`  ${n} ${s}`) : undefined);
  line(c.skipped, "unchanged, skipped");
  line(c.moved, "moved/renamed — existing raw file and catalog entry kept");
  line(c.copied, "text file(s) copied");
  line(c.extracted, "extracted");
  line(c.fromCache, "reused from the extraction cache (.ingest-cache/extracted/)");
  line(c.ocrd, "read by OCR");
  line(c.transcribed, "transcribed");
  line(c.captioned, "read from a caption sidecar (no transcription needed)");
  line(c.lowQuality, "marked `quality: low` — verify against the source when curating");
  line(c.pending, "not extracted (empty `raw` in log.md)");
}
