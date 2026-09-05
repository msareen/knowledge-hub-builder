// Shared file-type classification for every acquisition path.
//
// The kind decides which extractor runs, and every kind here has one — ingest is a single
// flat pass that converts everything it can, locally, with no agent turn in the middle.
import { readdirSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { normPath } from "../lib/util";

export const TEXT = [".md", ".txt", ".rst", ".adoc", ".html", ".csv", ".json", ".yaml", ".yml"];
/**
 * Born-digital documents. khb's own pure-JS libraries read all of these but `.one`, a
 * proprietary binary store with no JS reader worth carrying: that one goes out to pyOneNote
 * where the user has it, and pends a row naming the install where they don't (lib/extract).
 */
export const DOC = [".pdf", ".docx", ".odt", ".xlsx", ".pptx", ".one"];
/** Pixels. Read by tesseract OCR (lossy — `quality: low`), or by an agent vision pass. */
export const IMAGE = [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif"];
/** Audio and video: local whisper. Minutes of CPU per file, hence `--skip-audio`. */
export const AV = [".mp3", ".wav", ".m4a", ".flac", ".ogg", ".mp4", ".mov", ".mkv", ".webm"];
/**
 * Subtitle sidecars: the words of a recording, already written down by someone who could
 * hear it. Ordered by preference — the same captions often exist in both containers, and
 * `.vtt` carries speaker names where `.srt` does not.
 */
export const CAPTION = [".vtt", ".srt"];

export const extOf = (p: string) => {
  const i = p.lastIndexOf(".");
  return i < 0 ? "" : p.slice(i).toLowerCase();
};

/** raw/ files are always markdown — don't produce "budget.md.md". */
export const mdName = (n: string) => (n.toLowerCase().endsWith(".md") ? n : n + ".md");

export type Kind = "text" | "doc" | "image" | "av" | "caption" | "skip";
export function kindOf(path: string): Kind {
  const e = extOf(path);
  if (TEXT.includes(e)) return "text";
  if (DOC.includes(e)) return "doc";
  if (IMAGE.includes(e)) return "image";
  if (AV.includes(e)) return "av";
  if (CAPTION.includes(e)) return "caption";
  return "skip";
}

// --- sidecar pairing -------------------------------------------------------------------
//
// `talk.vtt` next to `talk.mp4` is not a second source, it is that recording's transcript.
// Pairing them is what lets ingest read the words instead of guessing at them with whisper,
// for no CPU and at higher fidelity. Both directions of the pairing are decided here so the
// two sides can never disagree about which file belongs to which.

/** One readdir per directory per run — a folder walk asks about the same siblings a lot. */
const listing = new Map<string, string[]>();
function siblings(path: string): { dir: string; names: string[] } {
  const dir = dirname(path) || ".";
  let names = listing.get(dir);
  if (!names) {
    try {
      names = readdirSync(dir);
    } catch {
      names = []; // unreadable directory: no sidecar, and the file itself will say why
    }
    listing.set(dir, names);
  }
  return { dir, names };
}

const stemOf = (name: string) => name.slice(0, name.length - extOf(name).length);

/**
 * A caption file's stem usually carries a language tag — `talk.en.vtt`, `talk.pt-BR.vtt`,
 * which is what yt-dlp and every "download the subtitles" button writes — beside a plain
 * `talk.mp4`. Strip one tag so the pair still matches.
 */
const untag = (stem: string) => stem.replace(/\.[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/, "");

/**
 * The caption sidecar belonging to a media file, when there is one obvious candidate.
 *
 * Two languages on disk is a choice about audience, and khb does not make choices: it
 * transcribes instead and leaves the sidecars for a human to point at. The same captions in
 * two containers is not a choice — they are the same words — so CAPTION order settles it.
 */
export function captionFor(media: string): string | undefined {
  if (kindOf(media) !== "av") return undefined;
  const { dir, names } = siblings(media);
  const stem = stemOf(basename(media));
  const captions = names.filter((n) => kindOf(n) === "caption");
  const exact = captions.filter((n) => stemOf(n) === stem);
  const pool = exact.length ? exact : captions.filter((n) => untag(stemOf(n)) === stem);
  if (!pool.length) return undefined;
  if (!exact.length && new Set(pool.map(stemOf)).size > 1) return undefined; // several languages
  const best = [...pool].sort((a, b) => CAPTION.indexOf(extOf(a)) - CAPTION.indexOf(extOf(b)))[0];
  return join(dir, best);
}

/**
 * The media file a caption sidecar belongs to, if any — deliberately defined in terms of
 * `captionFor`, so a caption is only somebody's sidecar when that somebody would actually
 * claim it. A caption with no recording beside it is a source in its own right.
 */
export function mediaFor(caption: string): string | undefined {
  if (kindOf(caption) !== "caption") return undefined;
  const { dir, names } = siblings(caption);
  const stems = new Set([stemOf(basename(caption)), untag(stemOf(basename(caption)))]);
  for (const n of names) {
    if (kindOf(n) !== "av" || !stems.has(stemOf(n))) continue;
    const media = join(dir, n);
    const found = captionFor(media);
    if (found && normPath(found) === normPath(caption)) return media;
  }
  return undefined;
}
