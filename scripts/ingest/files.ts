// Explicit file list → raw/files/. Same acquisition as a folder source, for the case where
// the interesting files are scattered and naming them is easier than naming a root.
import { existsSync } from "node:fs";
import { basename, normPath } from "../lib/util";
import type { Entry } from "../lib/ledger";
import { acquireFile, newCounters, report, type Options } from "./acquire";
import { detail, item, outcome, pos } from "../lib/log";
import { makeExcluder } from "./exclude";
import type { Source } from "./index";

export async function ingestFiles(
  source: Extract<Source, { type: "files" }>,
  rawDir: string,
  bundleDir: string,
  entries: Map<string, Entry>,
  opts: Options,
) {
  detail(`${source.paths.length} file(s) declared`);
  const excluded = makeExcluder(source.exclude);
  const paths = source.paths.filter((path) => !excluded(path, basename(path)));
  const skippedCount = source.paths.length - paths.length;
  if (skippedCount) detail(`${skippedCount} excluded by 'exclude' rule(s), ${paths.length} remain`);

  // What this source will visit, for the caption/media pairing: a `.vtt` is only folded
  // into a recording that is itself on the list, so naming just the sidecar still acquires
  // it on its own.
  const scoped = { ...opts, scope: new Set(paths.map((path) => normPath(path))) };

  const counters = newCounters();
  for (const [index, path] of paths.entries()) {
    const position = pos(index + 1, paths.length);
    if (!existsSync(path)) {
      item(position, path);
      outcome("missing, skipped");
      continue;
    }
    await acquireFile(position, path, basename(path), rawDir, bundleDir, entries, counters, scoped);
  }
  report(counters);
}
