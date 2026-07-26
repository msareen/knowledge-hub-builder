// Local folder → raw/folder/. Walks the tree and hands every file to acquireFile, which
// owns the extraction decisions. Unchanged files (same content hash, raw/ copy still
// present) are skipped.
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "../lib/util";
import type { Entry } from "../lib/ledger";
import { acquireFile, newCounters, report, type Options } from "./acquire";
import { detail, pos } from "../lib/log";
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

  // Walk the whole tree up front rather than streaming it: a corpus on a network share can
  // take a while to enumerate, and knowing the denominator is what makes "[ 3/57]" mean
  // anything to someone deciding whether to wait.
  detail(`scanning ${s.path} …`);
  const files = walk(s.path);
  detail(`${files.length} file(s) found`);

  const c = newCounters();
  for (const [i, p] of files.entries()) {
    // Flatten the subtree into the filename so two `notes.md` in sibling folders don't
    // collide in raw/, and so the origin stays legible without opening the file.
    const rel = p.slice(s.path.length + 1).replaceAll(/[\\/]/g, "__");
    await acquireFile(pos(i + 1, files.length), p, rel, rawDir, bundleDir, entries, c, opts);
  }
  report(c);
}
