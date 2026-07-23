// Explicit file list → raw/files/. Same acquisition as a folder source, for the case where
// the interesting files are scattered and naming them is easier than naming a root.
import { existsSync } from "node:fs";
import { basename } from "../lib/util";
import type { Entry } from "../lib/ledger";
import { acquireFile, newCounters, report, type Options } from "./acquire";
import type { Source } from "./index";

export async function ingestFiles(
  s: Extract<Source, { type: "files" }>,
  rawDir: string,
  bundleDir: string,
  entries: Map<string, Entry>,
  opts: Options,
) {
  const c = newCounters();
  for (const p of s.paths) {
    if (!existsSync(p)) {
      console.warn(`  missing, skipped: ${p}`);
      continue;
    }
    await acquireFile(p, basename(p), rawDir, bundleDir, entries, c, opts);
  }
  report(c);
}
