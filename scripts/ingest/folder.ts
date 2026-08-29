// Local folder → raw/folder/. Walks the tree and hands every file to acquireFile, which
// owns the extraction decisions. Unchanged files (same content hash, raw/ copy still
// present) are skipped.
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, normPath } from "../lib/util";
import type { Entry } from "../lib/ledger";
import { acquireFile, newCounters, report, type Options } from "./acquire";
import { detail, pos } from "../lib/log";
import { paintErr } from "../lib/color";
import { makeExcluder } from "./exclude";
import type { Source } from "./index";

export async function ingestFolder(
  s: Extract<Source, { type: "folder" }>,
  rawDir: string,
  bundleDir: string,
  entries: Map<string, Entry>,
  opts: Options,
) {
  if (!existsSync(s.path)) {
    console.warn(`  ${paintErr.warn("missing folder, skipped:")} ${s.path}`);
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
  const all = walk(s.path);
  detail(`${all.length} file(s) found`);

  // relOf is posix-normalized so an 'exclude' entry like "drafts/" behaves the same whether
  // the corpus was walked on Windows or POSIX; it's computed once and reused for both the
  // exclude check and the flattened raw/ filename below.
  const relOf = (p: string) => p.slice(s.path.length + 1).replaceAll("\\", "/");
  const excluded = makeExcluder(s.exclude);
  const files = all.filter((p) => !excluded(p, relOf(p)));
  const skippedCount = all.length - files.length;
  if (skippedCount) detail(`${skippedCount} excluded by 'exclude' rule(s), ${files.length} remain`);

  // What this walk will visit, for the caption/media pairing: a `.vtt` whose recording is
  // excluded (or simply absent) is acquired on its own rather than folded into a row that
  // would never appear.
  const scoped = { ...opts, scope: new Set(files.map((p) => normPath(p))) };

  const c = newCounters();
  for (const [i, p] of files.entries()) {
    // Flatten the subtree into the filename so two `notes.md` in sibling folders don't
    // collide in raw/, and so the origin stays legible without opening the file.
    const rel = relOf(p).replaceAll("/", "__");
    await acquireFile(pos(i + 1, files.length), p, rel, rawDir, bundleDir, entries, c, scoped);
  }
  report(c);
}
