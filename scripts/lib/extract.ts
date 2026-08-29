// Content-addressed extraction cache: .ingest-cache/extracted/<sha256>.md
//
// Binary formats have to be converted before anything can read them. That conversion is
// expensive and deterministic per content hash, so it is cached hub-wide rather than
// per-bundle. Nothing here ever writes into a bundle's `raw/` — `raw/` stays derived and
// rebuildable (templates/hub/gitignore:2); callers copy out of the cache.
//
// Extraction is built in. khb is tooling, so it carries the libraries: unpdf (pdf.js),
// mammoth and fflate are pure JS with no native build and no PATH assumptions, which is
// what lets `khb ingest` work on a bare machine. External CLIs are a bonus, not a
// requirement: if `pdftotext` or `pandoc` happen to be installed they get a second shot at
// anything the library couldn't read, because poppler still wins on gnarly layouts.
//
// Every route out of here is LOCAL and deterministic — pure-JS libraries, tesseract WASM,
// a whisper binary. None of it contacts a model. That is the AGENTS.md division of labor:
// khb converts bytes to text as cheaply as possible, and the agent's judgement is spent on
// curation, not on transcription.
//
// The two lossy routes (OCR, ASR) are marked `quality: low` rather than hidden. A pixel or
// audio source that extracted badly is not a dead end — the original file is still on disk
// and named in the provenance header, so curation can escalate to a vision read of the
// source instead of trusting garbled text.
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { INGEST_CACHE, join, basename } from "./util";
import { note } from "./log";

export const EXTRACTED = join(INGEST_CACHE, "extracted");

/** Below this many characters per page, a PDF is a picture of a document, not a document. */
const SCANNED_CHARS_PER_PAGE = 20;

/** `high` = real text out of a born-digital file. `low` = OCR/ASR guessed at it. */
export type Quality = "high" | "low";

export type Extraction =
  | { status: "ok"; path: string; tool: string; quality: Quality }
  | { status: "needs-ocr"; pages: number }   // renders fine, has no text layer — OCR is the only route
  | { status: "unsupported" }                // no extractor for this format
  | { status: "failed"; reason: string };    // tried, got nothing usable

export function extractedPath(hash: string): string {
  return join(EXTRACTED, `${hash}.md`);
}

/** Cached text minus the provenance header — what a `raw/` copy actually wants. */
export function extractedBody(path: string): string {
  const text = readFileSync(path, "utf8");
  const m = text.match(/^---\n[\s\S]*?\n---\n\n?/);
  return m ? text.slice(m[0].length) : text;
}

/**
 * How a cache entry was produced. Read back rather than re-derived, so a `raw/` copy made
 * from cache carries the same `extract_tool`/`quality` as the run that filled it.
 */
export function extractedMeta(path: string): { tool: string; quality: Quality } {
  const head = readFileSync(path, "utf8").slice(0, 2048);
  const tool = head.match(/^tool: (.*)$/m)?.[1]?.trim() || "unknown";
  const quality = head.match(/^quality: (.*)$/m)?.[1]?.trim() === "low" ? "low" : "high";
  return { tool, quality };
}

type LibResult = { text: string; pages?: number };

const unxml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Strip tags from an OOXML/ODF fragment, keeping paragraph breaks. */
const stripXml = (xml: string, breakOn: RegExp) =>
  unxml(xml.replace(breakOn, "\n").replace(/<[^>]+>/g, ""));

/** "BD" → 55. Preserves gaps so an empty cell doesn't shift the rest of the row left. */
function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// --- captions --------------------------------------------------------------------------
//
// WebVTT and SRT are the same document in two dialects: an optional cue index, a timecode
// line, then the words. Everything but the words is scaffolding for a player, and reaches
// curation as noise — a transcript diced into three-second lines, every one of them
// preceded by a timestamp nobody will read.
//
// Two things are worth keeping. *When*, coarsely: a transcript nobody can point into is
// hard to cite, so anything longer than a chapter gets a heading per interval, enough to
// find the passage in the recording. And *who*, where the file says so: WebVTT's `<v Name>`
// is the only speaker attribution that survives from the original, and it is exactly what a
// meeting or an interview is read for.
//
// One thing is worth removing beyond the scaffolding. Auto-generated captions scroll: each
// cue repeats the tail of the one before it so the viewer sees a stable two-line window.
// Written down verbatim that doubles the transcript and reads as a stutter, so an
// overlapping head is trimmed instead of appended twice.

/** Seconds per `## h:mm:ss` heading, and the length below which a transcript gets none. */
const CHAPTER = 300;

/**
 * Paragraph lengths, in characters. Captions have no paragraphs of their own — five minutes
 * of speech arrives as one unbroken line — so they get made here: break at the first
 * sentence end past SOFT, and give up and break anywhere past HARD, which is what
 * auto-generated captions need, since they carry no punctuation to break on.
 */
const SOFT = 600;
const HARD = 1600;

/** "01:02:03.456" or "02:03.456" → seconds. */
function cueSeconds(t: string): number {
  const m = t.match(/(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

/** A closing `.`, `?` or `!`, with the quote or bracket that may follow it. */
const SENTENCE_END = /[.!?]["')\]]?$/;

function stamp(s: number): string {
  const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`;
}

/** A cue's payload: its speaker, if the file names one, and its words minus the markup. */
function cueText(lines: string[]): { speaker?: string; text: string } {
  let speaker: string | undefined;
  const text = lines
    .join(" ")
    // <v Roger Bingham> / <v.loud Esme> — the voice span names who is talking.
    .replace(/<v[^\s>]*\s+([^>]*)>/g, (_, name: string) => {
      speaker ??= name.trim();
      return "";
    })
    // Everything else is presentation: <c> classes, </v>, and the inline <00:00:01.000>
    // stamps that karaoke-style captions put between words.
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ");
  return { speaker, text: unxml(text).replace(/\s+/g, " ").trim() };
}

/**
 * Append `next` to `text`, dropping the head the two share. Only a whole-word overlap of
 * some length counts: trimming on a coincidental few characters would splice two different
 * words into one, which is worse than the repetition it avoids.
 */
function joinOverlap(text: string, next: string): string {
  for (let k = Math.min(next.length, 400); k >= 4; k--) {
    if (!text.endsWith(next.slice(0, k))) continue;
    const before = text[text.length - k - 1];
    const after = next[k];
    if ((before !== undefined && before !== " ") || (after !== undefined && after !== " ")) continue;
    const rest = next.slice(k).trim();
    return rest ? `${text} ${rest}` : text;
  }
  return `${text} ${next}`;
}

/** WebVTT/SRT → prose. Pure text in, pure text out; no file access, so it is easy to test. */
export function captionText(raw: string): string {
  type Para = { at: number; speaker?: string; text: string };
  const paras: Para[] = [];
  let open: Para | undefined;

  for (const block of raw.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    // WEBVTT is the file signature; NOTE, STYLE and REGION blocks are metadata and CSS.
    if (!lines.length || /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    const timed = lines.findIndex((l) => l.includes("-->"));
    if (timed === -1) continue; // no timecode: not a cue
    const at = cueSeconds(lines[timed].split("-->")[0]);
    const { speaker, text } = cueText(lines.slice(timed + 1));
    if (!text) continue;
    // A cue break means nothing — captions are cut to fit a screen, mid-sentence — so cues
    // run together, and only a change of speaker or of chapter forces a new paragraph.
    const newPara =
      !open || open.speaker !== speaker || Math.floor(at / CHAPTER) !== Math.floor(open.at / CHAPTER);
    if (newPara) paras.push((open = { at, speaker, text }));
    else open.text = joinOverlap(open.text, text);
    if (open.text.length >= (SENTENCE_END.test(open.text) ? SOFT : HARD)) open = undefined;
  }

  const out: string[] = [];
  let chapter = -1;
  let voice: string | undefined;
  const long = paras.length > 0 && paras[paras.length - 1].at >= CHAPTER;
  for (const p of paras) {
    if (long && Math.floor(p.at / CHAPTER) !== chapter) {
      chapter = Math.floor(p.at / CHAPTER);
      voice = undefined; // name the speaker again under a new heading
      out.push(`## ${stamp(chapter * CHAPTER)}`);
    }
    // Label a turn, not every paragraph of one: a monologue broken for length is still one
    // person talking, and repeating their name down the page reads as a new speaker.
    out.push(p.speaker && p.speaker !== voice ? `**${p.speaker}:** ${p.text}` : p.text);
    voice = p.speaker;
  }
  return out.join("\n\n");
}

/** Built-in, pure-JS extractors. Loaded lazily so `khb init` never pays for them. */
const LIBRARY: Record<string, (file: string) => Promise<LibResult>> = {
  // Subtitle sidecars. Text already, but wrapped in cue indices and timecodes, so they get
  // an extractor rather than a verbatim copy — and the extraction cache with it, since the
  // same captions beside a re-encoded copy of a video are the same words.
  ".vtt": async (file) => ({ text: captionText(readFileSync(file, "utf8")) }),
  ".srt": async (file) => ({ text: captionText(readFileSync(file, "utf8")) }),
  ".pdf": async (file) => {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(new Uint8Array(readFileSync(file)));
    const { totalPages, text } = await extractText(doc, { mergePages: true });
    return { text, pages: totalPages };
  },
  ".docx": async (file) => {
    const mammoth = (await import("mammoth")).default;
    // Markdown keeps headings and lists, which are exactly the structure curation reads.
    const { value } = await mammoth.convertToMarkdown({ path: file });
    // mammoth escapes markdown punctuation defensively ("Non\-Disclosure", "2026\-02\-01").
    // That noise ends up in model snippets and in raw/, so undo it.
    return { text: value.replace(/\\([-_*#+.!\[\]()`])/g, "$1") };
  },
  ".odt": async (file) => {
    // ODT is a zip of XML, same shape as DOCX — cheap to support once fflate is here.
    const { unzipSync, strFromU8 } = await import("fflate");
    const zip = unzipSync(new Uint8Array(readFileSync(file)));
    const xml = strFromU8(zip["content.xml"] ?? new Uint8Array());
    return { text: stripXml(xml, /<text:(?:h|p)\b[^>]*>/g) };
  },
  // XLSX and PPTX are the same zip+XML shape as ODT, so they cost one parser each and no
  // new dependency. Spreadsheets in particular are worth having: a budget or a tracker is
  // knowledge, and it reaching curation as a blank row was the single biggest gap.
  ".xlsx": async (file) => {
    const { unzipSync, strFromU8 } = await import("fflate");
    const zip = unzipSync(new Uint8Array(readFileSync(file)));
    const at = (n: string) => (zip[n] ? strFromU8(zip[n]) : "");

    // Cell values are indices into one shared string table; resolve it before the sheets.
    const shared = [...at("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
      [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unxml(t[1])).join(""),
    );
    const names = [...at("xl/workbook.xml").matchAll(/<sheet[^>]*name="([^"]*)"/g)].map((m) => unxml(m[1]));
    const sheets = Object.keys(zip)
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));

    const out: string[] = [];
    sheets.forEach((sheetFile, i) => {
      const rows: string[][] = [];
      for (const rm of at(sheetFile).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells: string[] = [];
        for (const cm of rm[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
          const ref = cm[1].match(/r="([A-Z]+\d+)"/)?.[1];
          const type = cm[1].match(/t="([^"]*)"/)?.[1];
          const v = cm[2].match(/<v>([\s\S]*?)<\/v>/)?.[1];
          const value =
            type === "s" ? (shared[Number(v)] ?? "")
            : type === "inlineStr" ? [...cm[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unxml(t[1])).join("")
            : unxml(v ?? "");
          if (ref) cells[colIndex(ref)] = value;
        }
        // A sheet is mostly empty cells; drop rows that carry nothing at all.
        const filled = [...cells].map((c) => (c ?? "").replaceAll("|", "\\|").trim());
        if (filled.some(Boolean)) rows.push(filled);
      }
      if (!rows.length) return;
      // Pad every row to the widest one: a sparse sheet whose row 1 is narrower than row 5
      // otherwise renders as a ragged table, which no markdown reader will parse.
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, j) => r[j] ?? "").join(" | ")} |`;
      // A header separator after row 1 makes the sheet render as a table wherever raw/ is
      // read, and costs nothing when row 1 isn't really a header.
      const body = [line(rows[0]), `|${"---|".repeat(width)}`, ...rows.slice(1).map(line)];
      out.push(`## ${names[i] ?? basename(sheetFile)}\n\n${body.join("\n")}`);
    });
    return { text: out.join("\n\n") };
  },
  ".pptx": async (file) => {
    const { unzipSync, strFromU8 } = await import("fflate");
    const zip = unzipSync(new Uint8Array(readFileSync(file)));
    const slides = Object.keys(zip)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    const out = slides.map((s, i) => {
      const body = [...strFromU8(zip[s]).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => unxml(m[1])).join("\n");
      return body.trim() ? `## Slide ${i + 1}\n\n${body}` : "";
    });
    return { text: out.filter(Boolean).join("\n\n") };
  },
};

/** Optional second attempt: better fidelity, but only if the user happens to have them. */
const CLI: Record<string, (file: string) => string[]> = {
  ".pdf": (f) => ["pdftotext", "-layout", f, "-"],
  ".docx": (f) => ["pandoc", f, "-t", "gfm"],
  ".odt": (f) => ["pandoc", f, "-t", "gfm"],
  ".pptx": (f) => ["pandoc", f, "-t", "gfm"],
};

async function runCli(argv: string[]): Promise<string> {
  try {
    const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "ignore" });
    const text = await new Response(proc.stdout).text();
    return (await proc.exited) === 0 ? text : "";
  } catch {
    return ""; // not installed — expected, and not worth a warning
  }
}

function writeCache(dest: string, path: string, tool: string, quality: Quality, text: string): string {
  mkdirSync(EXTRACTED, { recursive: true });
  const fm =
    `---\nsource: ${path.replaceAll("\\", "/")}\nextracted: ${new Date().toISOString()}\n` +
    `tool: ${tool}\nquality: ${quality}\n---\n\n`;
  writeFileSync(dest, fm + text);
  return dest;
}

function cacheHit(dest: string): Extraction {
  return { status: "ok", path: dest, ...extractedMeta(dest) };
}

/**
 * Fill the cache for this file's extracted text and say what happened.
 * Never throws — a run over thousands of files degrades per file instead of aborting.
 */
export async function extractCached(path: string, hash: string, ext: string): Promise<Extraction> {
  const dest = extractedPath(hash);
  if (existsSync(dest)) return cacheHit(dest);
  if (!LIBRARY[ext]) return { status: "unsupported" };

  let pages: number | undefined;
  let text = "";
  let tool = ext.slice(1);
  try {
    const r = await LIBRARY[ext](path);
    text = r.text;
    pages = r.pages;
  } catch {
    text = ""; // corrupt, encrypted, or a format surprise — the CLI may still cope
  }

  if (!text.trim() && CLI[ext]) {
    const bin = CLI[ext](path)[0];
    note(`built-in reader recovered nothing — retrying with ${bin} if installed …`);
    text = await runCli(CLI[ext](path));
    if (text.trim()) tool = bin;
  }

  // Pages but (near-)no characters is the signature of a scan. Check before declaring
  // success: a scan stamped with a page number yields a few characters, not zero, and
  // calling that "extracted" would hide a document that OCR could actually read.
  const trimmed = text.trim();
  if (pages && trimmed.length / pages < SCANNED_CHARS_PER_PAGE) return { status: "needs-ocr", pages };
  if (trimmed) return { status: "ok", path: writeCache(dest, path, tool, "high", trimmed), tool, quality: "high" };
  return { status: "failed", reason: "no text recovered" };
}

/**
 * Lazily loaded OCR stack, shared by the PDF and bare-image paths. The install hint is
 * printed once per process, not once per file — a corpus of scans would otherwise bury its
 * own summary under hundreds of identical warnings.
 */
let ocrWarned = false;
async function ocrDeps() {
  try {
    const { createWorker } = await import("tesseract.js");
    return { createWorker };
  } catch {
    if (!ocrWarned) {
      // Resolution is relative to the khb package, not the hub — say where, because for a
      // global install those are different directories and `bun add` in the hub is a no-op.
      const { PKG } = await import("./paths");
      console.warn(`  OCR unavailable. Install it where khb resolves modules from:`);
      console.warn(`    cd ${PKG} && bun add @hyzyla/pdfium sharp tesseract.js`);
      ocrWarned = true;
    }
    return null;
  }
}

/**
 * OCR a scanned PDF: render each page, then read the pixels. Runs automatically during
 * ingest when a PDF turns out to have no text layer — a scan is not a failure, it just
 * needs a different reader — but the deps are optional (~75 MB of WASM plus a one-time
 * language-data download), so a missing stack degrades to a pending ledger row.
 *
 *   bun add @hyzyla/pdfium sharp tesseract.js
 */
export async function ocrCached(path: string, hash: string, dpi = 216): Promise<Extraction> {
  const dest = extractedPath(hash);
  if (existsSync(dest)) return cacheHit(dest);

  const deps = await ocrDeps();
  if (!deps) return { status: "failed", reason: "OCR dependencies not installed" };
  let PDFiumLibrary, sharp;
  try {
    ({ PDFiumLibrary } = await import("@hyzyla/pdfium"));
    sharp = (await import("sharp")).default;
  } catch {
    return { status: "failed", reason: "OCR dependencies not installed" };
  }

  const lib = await PDFiumLibrary.init();
  const worker = await deps.createWorker("eng");
  const tool = `tesseract.js @ ${dpi}dpi`;
  try {
    const doc = await lib.loadDocument(readFileSync(path));
    // Materialize the page list for the denominator: this loop is the longest thing khb
    // does, and "page 7/94" is the difference between waiting and killing the process.
    const all = [...doc.pages()];
    const pages: string[] = [];
    for (const [i, page] of all.entries()) {
      const img = await page.render({
        scale: dpi / 72,
        render: (o: { data: Buffer; width: number; height: number }) =>
          sharp(o.data, { raw: { width: o.width, height: o.height, channels: 4 } }).png().toBuffer(),
      });
      const { data } = await worker.recognize(Buffer.from(img.data));
      const text = data.text.trim();
      note(`  page ${i + 1}/${all.length} — ${text.length} chars`);
      pages.push(text);
    }
    doc.destroy();
    const text = pages.filter(Boolean).join("\n\n---\n\n");
    if (!text) return { status: "failed", reason: "OCR produced no text" };
    return { status: "ok", path: writeCache(dest, path, tool, "low", text), tool, quality: "low" };
  } catch (e) {
    return { status: "failed", reason: `OCR failed: ${e}` };
  } finally {
    await worker.terminate();
    lib.destroy();
  }
}

/**
 * OCR a bare image (screenshot, photographed page, scanned receipt). Same tesseract pass
 * as a scanned PDF minus the render step, since the pixels are already the file.
 *
 * This deliberately does NOT try to understand a diagram or a chart — OCR reads glyphs.
 * The `quality: low` marker plus the source path in the header is how curation knows to
 * escalate to a vision read when the text comes back thin or nonsensical.
 */
export async function ocrImageCached(path: string, hash: string): Promise<Extraction> {
  const dest = extractedPath(hash);
  if (existsSync(dest)) return cacheHit(dest);

  const deps = await ocrDeps();
  if (!deps) return { status: "failed", reason: "OCR dependencies not installed" };

  const worker = await deps.createWorker("eng");
  try {
    const { data } = await worker.recognize(readFileSync(path));
    const text = data.text.trim();
    if (!text) return { status: "failed", reason: "no text in image — vision read may still help" };
    return { status: "ok", path: writeCache(dest, path, "tesseract.js", "low", text), tool: "tesseract.js", quality: "low" };
  } catch (e) {
    return { status: "failed", reason: `OCR failed: ${e}` };
  } finally {
    await worker.terminate();
  }
}

/**
 * Is `vno` installed, and is it actually ready to run?
 *
 * `vno status` exists for exactly this: it reports and installs nothing, and exits non-zero
 * when ffmpeg or whisper.cpp or a model is missing — so a vno that is installed but never
 * set up is caught here rather than discovered one silent per-file failure at a time.
 * `--json` turns the same answer into the blocker list that makes khb's message actionable.
 *
 * An older vno predating `status` would fail this check for the wrong reason, so a
 * response that is not JSON at all falls back to the presence test it used to get. That
 * costs a second spawn only on the rare path.
 */
type VnoState =
  | { state: "ready" }
  | { state: "unset-up"; blockers: string[] }  // installed, but ffmpeg/whisper.cpp/model missing
  | { state: "absent" };

async function vnoStatus(): Promise<VnoState> {
  let out: string;
  let code: number;
  try {
    const proc = Bun.spawn(["vno", "status", "--json"], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    out = await new Response(proc.stdout).text();
    code = await proc.exited;
  } catch {
    return { state: "absent" }; // not on PATH — expected, and not worth a warning
  }
  if (code === 0) return { state: "ready" };
  try {
    const blockers = JSON.parse(out).blockers;
    return { state: "unset-up", blockers: Array.isArray(blockers) ? blockers.map(String) : [] };
  } catch {
    return (await runCli(["vno", "--version"])) ? { state: "ready" } : { state: "absent" };
  }
}

/**
 * The local speech-to-text engine, probed once per process — spawning a status check per
 * file would cost more than it saves.
 *
 * `vno` (@msareen/voice-notes-organizer) is preferred where it is set up. It is whisper.cpp
 * under a wrapper, so it is markedly faster than the Python whisper on the same audio and
 * uses whatever acceleration the machine has; it installs its own ffmpeg and model; and it
 * emits WebVTT, which the caption reader above turns into a transcript with `## h:mm:ss`
 * anchors instead of an undifferentiated wall of text. Same division of labor either way: a
 * local binary doing a reproducible conversion, contacting no model.
 *
 * A vno that is installed but not set up is an amber gate, never a red one. Nothing about
 * the run stops: whisper takes over if it is there, and if it is not, the recordings pend
 * with an empty `raw` like every other unavailable extractor and the rest of the corpus is
 * ingested regardless. All khb owes the user is an accurate reason and the one command that
 * fixes it — running `vno setup` on their behalf would be khb installing software nobody
 * asked it to install.
 */
type Engine = { bin: string; kind: "vno" | "whisper" };
let engine: Engine | null | undefined;
let vnoAmber: string | undefined; // set when vno is installed but not set up

async function asrEngine(): Promise<Engine | null> {
  if (engine !== undefined) return engine;

  const vno = await vnoStatus();
  if (vno.state === "unset-up") {
    const missing = vno.blockers.length ? `: ${vno.blockers.join(", ")}` : "";
    vnoAmber = `vno is installed but not set up${missing} — run:  vno setup`;
  }

  engine =
    vno.state === "ready" ? { bin: "vno", kind: "vno" }
    : (await runCli(["whisper", "--help"])) ? { bin: "whisper", kind: "whisper" }
    : (await runCli(["faster-whisper", "--help"])) ? { bin: "faster-whisper", kind: "whisper" }
    : null;

  // Amber: say it once, then carry on with whatever else is available.
  if (vnoAmber) console.warn(`  ${vnoAmber}${engine ? ` (using ${engine.bin} instead)` : ""}`);
  if (!engine) {
    console.warn(`  no transcriber ready — audio and video skipped, everything else proceeds. Install either:`);
    if (!vnoAmber) console.warn(`    npm install -g @msareen/voice-notes-organizer   (whisper.cpp; installs its own deps)`);
    console.warn(`    pip install -U openai-whisper`);
  }
  return engine;
}

/**
 * `vno t <file> -o <out> --no-open` — the one-shot path: no picker, no model prompt, and no
 * requirement that the file live in vno's own library. The model is left to the user's vno
 * settings rather than pinned here, since those are also where their acceleration lives.
 *
 * stdin is closed deliberately. vno offers to install a missing ffmpeg or whisper.cpp, and
 * checks `isTTY` before asking — so a closed stdin turns that offer into printed
 * instructions rather than a prompt with nobody there to answer it.
 */
async function transcribeVno(path: string, dest: string, out: string): Promise<Extraction> {
  const tool = "vno (whisper.cpp)";
  const vtt = join(out, "transcript.vtt");
  const proc = Bun.spawn(["vno", "t", path, "-o", vtt, "--no-open"], {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });
  await proc.exited;
  // vno reports a missing file or an unusable dependency on stdout and still exits 0, so
  // the transcript existing is the only signal worth trusting here.
  if (!existsSync(vtt)) return { status: "failed", reason: "vno produced no transcript" };
  const text = captionText(readFileSync(vtt, "utf8"));
  if (!text) return { status: "failed", reason: "empty transcript" };
  return { status: "ok", path: writeCache(dest, path, tool, "low", text), tool, quality: "low" };
}

/** OpenAI whisper (or faster-whisper): plain text, written into a scratch --output_dir. */
async function transcribeWhisper(
  path: string,
  dest: string,
  out: string,
  bin: string,
  model: string,
): Promise<Extraction> {
  const tool = `${bin} (${model})`;
  const proc = Bun.spawn([bin, path, "--model", model, "--output_format", "txt", "--output_dir", out], {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });
  if ((await proc.exited) !== 0) return { status: "failed", reason: `${bin} exited non-zero` };
  const txt = readdirSync(out).find((f) => f.endsWith(".txt"));
  if (!txt) return { status: "failed", reason: `${bin} produced no transcript` };
  const text = readFileSync(join(out, txt), "utf8").trim();
  if (!text) return { status: "failed", reason: "empty transcript" };
  return { status: "ok", path: writeCache(dest, path, tool, "low", text), tool, quality: "low" };
}

/**
 * Transcribe audio or video locally. Video needs no demux step — both engines read the
 * audio track directly.
 *
 * Minutes of CPU per file, so this is the one extractor worth interrupting: `khb ingest
 * --skip-audio` leaves the rows pending and everything else proceeds. A recording that
 * arrived with captions beside it never gets here at all; ingest reads those instead.
 */
export async function transcribeCached(path: string, hash: string, model = "base"): Promise<Extraction> {
  const dest = extractedPath(hash);
  if (existsSync(dest)) return cacheHit(dest);

  const eng = await asrEngine();
  // The pending row carries the reason a person can act on: "not set up" and "not installed"
  // have different fixes, and the ledger is where this is read back weeks later.
  if (!eng) return { status: "failed", reason: vnoAmber ?? "no transcriber installed" };
  note(`transcribing with ${eng.bin}`);

  // Both engines write files rather than to stdout; give each run a scratch directory of
  // its own so a stray sibling transcript is never mistaken for this one's.
  const out = join(INGEST_CACHE, "tmp", hash.slice(0, 12));
  mkdirSync(out, { recursive: true });
  try {
    return eng.kind === "vno"
      ? await transcribeVno(path, dest, out)
      : await transcribeWhisper(path, dest, out, eng.bin, model);
  } catch (e) {
    return { status: "failed", reason: `transcription failed: ${e}` };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
