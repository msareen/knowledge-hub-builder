// Content-addressed extraction cache: inbox/extracted/<sha256>.md
//
// Binary formats (PDF, DOCX) have to go through an external CLI before anything can
// read them. That conversion is expensive and deterministic per content hash, so it is
// cached hub-wide rather than per-bundle. Nothing here ever writes into a bundle's
// `raw/` — `raw/` stays derived and rebuildable (templates/hub/gitignore:2); callers
// copy out of the cache when they want a raw/ file.
//
// Every failure mode returns null. A missing pdftotext, a non-zero exit, an empty
// conversion — all of them degrade to "pending extraction", none of them abort a run
// that is walking thousands of files.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { INBOX, join } from "./util";

export const EXTRACTED = join(INBOX, "extracted");

/** ext -> argv. The tool must write the converted text to stdout. */
const EXTRACTORS: Record<string, (file: string) => string[]> = {
  ".pdf": (f) => ["pdftotext", "-layout", f, "-"],
  ".docx": (f) => ["pandoc", f, "-t", "gfm"],
};

// Audio (.mp3/.wav/.m4a/.mp4) is EXTRACTABLE but absent here on purpose: whisper writes
// to files rather than stdout, which fits this cache poorly. ingest.md keeps it as
// agent-run CLI work.

export const EXTRACTABLE_HERE = Object.keys(EXTRACTORS);

export function extractedPath(hash: string): string {
  return join(EXTRACTED, `${hash}.md`);
}

/** Cached text minus the provenance header — what a model or a raw/ copy actually wants. */
export function extractedBody(path: string): string {
  const text = readFileSync(path, "utf8");
  const m = text.match(/^---\n[\s\S]*?\n---\n\n?/);
  return m ? text.slice(m[0].length) : text;
}

const warned = new Set<string>();

/**
 * Return the cache path for this file's extracted text, converting it first if needed.
 * Null means "no text available" — the caller degrades, never throws.
 */
export async function extractCached(path: string, hash: string, ext: string): Promise<string | null> {
  const dest = extractedPath(hash);
  if (existsSync(dest)) return dest;

  const argv = EXTRACTORS[ext]?.(path);
  if (!argv) return null;

  let text: string;
  try {
    const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
    text = await new Response(proc.stdout).text();
    if ((await proc.exited) !== 0) return null;
  } catch {
    // Almost always ENOENT — the converter isn't installed. Say so once, not per file.
    if (!warned.has(argv[0])) {
      warned.add(argv[0]);
      console.warn(`  ${argv[0]} not found on PATH — ${ext} files will stay pending`);
    }
    return null;
  }
  if (!text.trim()) return null;

  mkdirSync(EXTRACTED, { recursive: true });
  const fm = `---\nsource: ${path.replaceAll("\\", "/")}\nextracted: ${new Date().toISOString()}\ntool: ${argv[0]}\n---\n\n`;
  writeFileSync(dest, fm + text);
  return dest;
}
