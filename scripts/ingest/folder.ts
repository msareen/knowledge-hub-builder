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
  source: Extract<Source, { type: "folder" }>,
  rawDir: string,
  bundleDir: string,
  entries: Map<string, Entry>,
  opts: Options,
) {
  if (!existsSync(source.path)) {
    console.warn(`  ${paintErr.warn("missing folder, skipped:")} ${source.path}`);
    return;
  }

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((child) => {
      const childPath = join(dir, child);
      return statSync(childPath).isDirectory() ? walk(childPath) : [childPath];
    });

  // Walk the whole tree up front rather than streaming it: a corpus on a network share can
  // take a while to enumerate, and knowing the denominator is what makes "[ 3/57]" mean
  // anything to someone deciding whether to wait.
  detail(`scanning ${source.path} …`);
  const found = walk(source.path);
  detail(`${found.length} file(s) found`);

  // relOf is posix-normalized so an 'exclude' entry like "drafts/" behaves the same whether
  // the corpus was walked on Windows or POSIX; it's computed once and reused for both the
  // exclude check and the flattened raw/ filename below.
  const relOf = (path: string) => path.slice(source.path.length + 1).replaceAll("\\", "/");
  const excluded = makeExcluder(source.exclude);
  const files = found.filter((path) => !excluded(path, relOf(path)));
  const skippedCount = found.length - files.length;
  if (skippedCount) detail(`${skippedCount} excluded by 'exclude' rule(s), ${files.length} remain`);

  // What this walk will visit, for the caption/media pairing: a `.vtt` whose recording is
  // excluded (or simply absent) is acquired on its own rather than folded into a row that
  // would never appear.
  const scoped = { ...opts, scope: new Set(files.map((path) => normPath(path))) };

  const counters = newCounters();
  for (const [index, path] of files.entries()) {
    // Flatten the subtree into the filename so two `notes.md` in sibling folders don't
    // collide in raw/, and so the origin stays legible without opening the file.
    const rel = relOf(path).replaceAll("/", "__");
    await acquireFile(pos(index + 1, files.length), path, rel, rawDir, bundleDir, entries, counters, scoped);
  }
  report(counters);
}
