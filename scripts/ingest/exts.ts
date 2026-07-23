// Shared file-type classification for every acquisition path.
//
// The kind decides which extractor runs, and every kind here has one — ingest is a single
// flat pass that converts everything it can, locally, with no agent turn in the middle.
export const TEXT = [".md", ".txt", ".rst", ".adoc", ".html", ".csv", ".json", ".yaml", ".yml"];
/** Born-digital documents: khb's own pure-JS libraries read these, no system install. */
export const DOC = [".pdf", ".docx", ".odt", ".xlsx", ".pptx"];
/** Pixels. Read by tesseract OCR (lossy — `quality: low`), or by an agent vision pass. */
export const IMAGE = [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif"];
/** Audio and video: local whisper. Minutes of CPU per file, hence `--skip-audio`. */
export const AV = [".mp3", ".wav", ".m4a", ".flac", ".ogg", ".mp4", ".mov", ".mkv", ".webm"];

export const extOf = (p: string) => {
  const i = p.lastIndexOf(".");
  return i < 0 ? "" : p.slice(i).toLowerCase();
};

/** raw/ files are always markdown — don't produce "budget.md.md". */
export const mdName = (n: string) => (n.toLowerCase().endsWith(".md") ? n : n + ".md");

export type Kind = "text" | "doc" | "image" | "av" | "skip";
export function kindOf(path: string): Kind {
  const e = extOf(path);
  if (TEXT.includes(e)) return "text";
  if (DOC.includes(e)) return "doc";
  if (IMAGE.includes(e)) return "image";
  if (AV.includes(e)) return "av";
  return "skip";
}
