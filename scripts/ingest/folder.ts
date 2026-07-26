// Local folder → raw/folder/. Walks the tree and hands every file to acquireFile, which
// owns the extraction decisions. Unchanged files (same content hash, raw/ copy still
// present) are skipped.
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "../lib/util";
import type { Entry } from "../lib/ledger";
import { acquireFile, newCounters, report, type Options } from "./acquire";
import type { Source } from "./index";

export async function ingestFolder(
  s: Extract<Source, { type: "folder" }>,
  rawDir: string,
  bundleDir: string,
  entries: Map<string, Entry>,
  opts: Options,
) {
  if (!existsSync(s.path)) {
    console.warn(`  missing folder, skipped: ${s.path}`);
    return;
  }

  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });

  const c = newCounters();
  for (const p of walk(s.path)) {
    // Flatten the subtree into the filename so two `notes.md` in sibling folders don't
    // collide in raw/, and so the origin stays legible without opening the file.
    const rel = p.slice(s.path.length + 1).replaceAll(/[\\/]/g, "__");
    await acquireFile(p, rel, rawDir, bundleDir, entries, c, opts);
  }
  report(c);
}
