// Content-addressed extraction cache: inbox/extracted/<sha256>.md
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
// a whisper binary. None of it contacts a model. That is the AGENT.md division of labor:
// khb converts bytes to text as cheaply as possible, and the agent's judgement is spent on
// curation, not on transcription.
//
// The two lossy routes (OCR, ASR) are marked `quality: low` rather than hidden. A pixel or
// audio source that extracted badly is not a dead end — the original file is still on disk
// and named in the provenance header, so curation can escalate to a vision read of the
// source instead of trusting garbled text.
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { INBOX, join, basename } from "./util";

export const EXTRACTED = join(INBOX, "extracted");

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

/** Built-in, pure-JS extractors. Loaded lazily so `khb init` never pays for them. */
const LIBRARY: Record<string, (file: string) => Promise<LibResult>> = {
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
    text = await runCli(CLI[ext](path));
    if (text.trim()) tool = CLI[ext](path)[0];
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
    const pages: string[] = [];
    for (const page of doc.pages()) {
      const img = await page.render({
        scale: dpi / 72,
        render: (o: { data: Buffer; width: number; height: number }) =>
          sharp(o.data, { raw: { width: o.width, height: o.height, channels: 4 } }).png().toBuffer(),
      });
      const { data } = await worker.recognize(Buffer.from(img.data));
      pages.push(data.text.trim());
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

/** Probe once per process: spawning `--help` per file would cost more than it saves. */
let whisper: string | undefined;
async function whisperBin(): Promise<string> {
  if (whisper !== undefined) return whisper;
  whisper = (await runCli(["whisper", "--help"])) ? "whisper"
    : (await runCli(["faster-whisper", "--help"])) ? "faster-whisper"
    : "";
  if (!whisper) console.warn(`  whisper not on PATH — transcription skipped. Install:  pip install -U openai-whisper`);
  return whisper;
}

/**
 * Transcribe audio or video with a local whisper binary. Video needs no demux step —
 * whisper reads the audio track directly.
 *
 * Minutes of CPU per file, so this is the one extractor worth interrupting: `khb ingest
 * --skip-audio` leaves the rows pending and everything else proceeds. Still local and
 * still deterministic-enough to belong in khb rather than in an agent pass.
 */
export async function transcribeCached(path: string, hash: string, model = "base"): Promise<Extraction> {
  const dest = extractedPath(hash);
  if (existsSync(dest)) return cacheHit(dest);

  const bin = await whisperBin();
  if (!bin) return { status: "failed", reason: "whisper not installed" };

  // whisper writes <name>.txt into --output_dir rather than to stdout; give it a scratch
  // directory of its own so a stray sibling .txt never gets mistaken for the transcript.
  const out = join(INBOX, "tmp", hash.slice(0, 12));
  mkdirSync(out, { recursive: true });
  const tool = `${bin} (${model})`;
  try {
    const proc = Bun.spawn([bin, path, "--model", model, "--output_format", "txt", "--output_dir", out], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await proc.exited) !== 0) return { status: "failed", reason: `${bin} exited non-zero` };
    const txt = readdirSync(out).find((f) => f.endsWith(".txt"));
    if (!txt) return { status: "failed", reason: `${bin} produced no transcript` };
    const text = readFileSync(join(out, txt), "utf8").trim();
    if (!text) return { status: "failed", reason: "empty transcript" };
    return { status: "ok", path: writeCache(dest, path, tool, "low", text), tool, quality: "low" };
  } catch (e) {
    return { status: "failed", reason: `transcription failed: ${e}` };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
