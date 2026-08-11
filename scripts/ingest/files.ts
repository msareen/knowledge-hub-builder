// Explicit file list → raw/files/. Same acquisition as a folder source, for the case where
// the interesting files are scattered and naming them is easier than naming a root.
import { existsSync } from "node:fs";
import { basename } from "../lib/util";
import type { Entry } from "../lib/ledger";
import { acquireFile, newCounters, report, type Options } from "./acquire";
import { detail, item, outcome, pos } from "../lib/log";
import { makeExcluder } from "./exclude";
import type { Source } from "./index";

export async function ingestFiles(
  s: Extract<Source, { type: "files" }>,
  rawDir: string,
  bundleDir: string,
  entries: Map<string, Entry>,
  opts: Options,
) {
  detail(`${s.paths.length} file(s) declared`);
  const excluded = makeExcluder(s.exclude);
  const paths = s.paths.filter((p) => !excluded(p, basename(p)));
  const skippedCount = s.paths.length - paths.length;
  if (skippedCount) detail(`${skippedCount} excluded by 'exclude' rule(s), ${paths.length} remain`);

  const c = newCounters();
  for (const [i, p] of paths.entries()) {
    const at = pos(i + 1, paths.length);
    if (!existsSync(p)) {
      item(at, p);
      outcome("missing, skipped");
      continue;
    }
    await acquireFile(at, p, basename(p), rawDir, bundleDir, entries, c, opts);
  }
  report(c);
}
