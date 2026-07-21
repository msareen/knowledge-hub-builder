// Content-addressed extraction cache: inbox/extracted/<sha256>.md
//
// Binary formats have to be converted before anything can read them. That conversion is
// expensive and deterministic per content hash, so it is cached hub-wide rather than
// per-bundle. Nothing here ever writes into a bundle's `raw/` — `raw/` stays derived and
// rebuildable (templates/hub/gitignore:2); callers copy out of the cache.
//
// Extraction is built in. khb is tooling, so it carries the libraries: unpdf (pdf.js),
// mammoth and fflate are pure JS with no native build and no PATH assumptions, which is
// what lets `khb catalog` work on a bare machine. External CLIs are a bonus, not a
// requirement: if `pdftotext` or `pandoc` happen to be installed they get a second shot at
// anything the library couldn't read, because poppler still wins on gnarly layouts.
//
// A PDF that yields no text is NOT the same failure as a missing extractor — it is a scan
// with no text layer, and the only thing that reads it is OCR. That distinction is
// reported (`scanned`) rather than collapsed into a generic failure, so the caller knows
// OCR is the remedy instead of assuming there is nothing to do.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { INBOX, join } from "./util";

export const EXTRACTED = join(INBOX, "extracted");

/** Below this many characters per page, a PDF is a picture of a document, not a document. */
const SCANNED_CHARS_PER_PAGE = 20;

export type Extraction =
  | { status: "ok"; path: string }        // text is in the cache, at `path`
  | { status: "scanned"; pages: number }  // renders fine, has no text layer — OCR is the only route
  | { status: "unsupported" }             // no extractor for this format (audio/video: see skills/ingest/SKILL.md)
  | { status: "failed" };                 // tried, got nothing usable

export function extractedPath(hash: string): string {
  return join(EXTRACTED, `${hash}.md`);
}

/** Cached text minus the provenance header — what a model or a raw/ copy actually wants. */
export function extractedBody(path: string): string {
  const text = readFileSync(path, "utf8");
  const m = text.match(/^---\n[\s\S]*?\n---\n\n?/);
  return m ? text.slice(m[0].length) : text;
}

type LibResult = { text: string; pages?: number };

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
    const text = xml
      .replace(/<text:(?:h|p)\b[^>]*>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    return { text };
  },
};

/** Optional second attempt: better fidelity, but only if the user happens to have them. */
const CLI: Record<string, (file: string) => string[]> = {
  ".pdf": (f) => ["pdftotext", "-layout", f, "-"],
  ".docx": (f) => ["pandoc", f, "-t", "gfm"],
  ".odt": (f) => ["pandoc", f, "-t", "gfm"],
};

// Audio and video are deliberately absent: transcription is a different cost class
// (minutes of compute per file) and belongs to an explicit, agent-run whisper pass.
// See the Audio/Video row in skills/ingest/SKILL.md.

async function runCli(argv: string[]): Promise<string> {
  try {
    const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "ignore" });
    const text = await new Response(proc.stdout).text();
    return (await proc.exited) === 0 ? text : "";
  } catch {
    return ""; // not installed — expected, and not worth a warning
  }
}

function writeCache(dest: string, path: string, tool: string, text: string): string {
  mkdirSync(EXTRACTED, { recursive: true });
  const fm = `---\nsource: ${path.replaceAll("\\", "/")}\nextracted: ${new Date().toISOString()}\ntool: ${tool}\n---\n\n`;
  writeFileSync(dest, fm + text);
  return dest;
}

/**
 * Fill the cache for this file's extracted text and say what happened.
 * Never throws — a run over thousands of files degrades per file instead of aborting.
 */
export async function extractCached(path: string, hash: string, ext: string): Promise<Extraction> {
  const dest = extractedPath(hash);
  if (existsSync(dest)) return { status: "ok", path: dest };
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
  if (pages && trimmed.length / pages < SCANNED_CHARS_PER_PAGE) return { status: "scanned", pages };
  if (trimmed) return { status: "ok", path: writeCache(dest, path, tool, trimmed) };
  return { status: "failed" };
}

/**
 * OCR a scanned PDF: render each page, then read the pixels. Opt-in, because the stack is
 * ~75 MB of optional dependencies plus a one-time language-data download, and a pass costs
 * seconds per page against milliseconds for real text extraction.
 *
 *   bun add @hyzyla/pdfium sharp tesseract.js
 */
export async function ocrCached(path: string, hash: string, dpi = 216): Promise<Extraction> {
  const dest = extractedPath(hash);
  if (existsSync(dest)) return { status: "ok", path: dest };

  let PDFiumLibrary, sharp, createWorker;
  try {
    ({ PDFiumLibrary } = await import("@hyzyla/pdfium"));
    sharp = (await import("sharp")).default;
    ({ createWorker } = await import("tesseract.js"));
  } catch {
    // Resolution is relative to the khb package, not the hub — say where, because for a
    // global install those are different directories and `bun add` in the hub is a no-op.
    const { PKG } = await import("./paths");
    console.warn(`  OCR unavailable. Install it where khb resolves modules from:`);
    console.warn(`    cd ${PKG} && bun add @hyzyla/pdfium sharp tesseract.js`);
    return { status: "failed" };
  }

  const lib = await PDFiumLibrary.init();
  const worker = await createWorker("eng");
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
    if (!text) return { status: "failed" };
    return { status: "ok", path: writeCache(dest, path, `tesseract.js @ ${dpi}dpi`, text) };
  } catch {
    return { status: "failed" };
  } finally {
    await worker.terminate();
    lib.destroy();
  }
}
