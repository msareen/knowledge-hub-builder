// Shared file-type classification for every acquisition path (folder, files, triage).
export const TEXT = [".md", ".txt", ".rst", ".adoc", ".html", ".csv", ".json", ".yaml", ".yml"];
export const EXTRACTABLE = [".pdf", ".docx", ".mp3", ".wav", ".m4a", ".mp4"];

export const extOf = (p: string) => {
  const i = p.lastIndexOf(".");
  return i < 0 ? "" : p.slice(i).toLowerCase();
};

/** raw/ files are always markdown — don't produce "budget.md.md". */
export const mdName = (n: string) => (n.toLowerCase().endsWith(".md") ? n : n + ".md");

export type Kind = "text" | "extractable" | "skip";
export function kindOf(path: string): Kind {
  const e = extOf(path);
  return TEXT.includes(e) ? "text" : EXTRACTABLE.includes(e) ? "extractable" : "skip";
}
