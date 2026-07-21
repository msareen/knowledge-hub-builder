// Explicit file list → raw/files/. Produced by `khb route` from a triage manifest,
// so the paths are already topic-assigned. Skips anything whose content hash is
// unchanged and whose raw/ copy is still present.
import { readFileSync, existsSync } from "node:fs";
import { writeRaw, sha256File, basename } from "../lib/util";
import { record, isFresh, type Entry } from "../lib/ledger";
import { extractedPath, extractedBody } from "../lib/extract";
import { kindOf, mdName } from "./exts";
import type { Source } from "./index";

export async function ingestFiles(
  s: Extract<Source, { type: "files" }>,
  rawDir: string,
  bundleDir: string,
  entries: Map<string, Entry>,
  force: boolean,
) {
  let skipped = 0, pending = 0, fromCache = 0;
  for (const p of s.paths) {
    if (!existsSync(p)) {
      console.warn(`  missing, skipped: ${p}`);
      continue;
    }
    const hash = await sha256File(p);
    if (!force && isFresh(entries, bundleDir, p, hash)) {
      skipped++;
      continue;
    }
    const kind = kindOf(p);
    if (kind === "text") {
      const raw = writeRaw(rawDir, mdName(basename(p)), p, readFileSync(p, "utf8"));
      record(entries, { source: p, sha256: hash, fetched: new Date().toISOString(), raw });
    } else if (kind === "extractable") {
      // `khb catalog` may already have converted this exact content. The cache is keyed by
      // hash, so copy out of it rather than shelling out again — a copy, not a move, so
      // raw/ stays derived and the cache stays reusable by other bundles.
      const cached = extractedPath(hash);
      if (existsSync(cached)) {
        const raw = writeRaw(rawDir, mdName(basename(p)), p, extractedBody(cached));
        record(entries, { source: p, sha256: hash, fetched: new Date().toISOString(), raw });
        fromCache++;
      } else {
        // Otherwise acquisition is a CLI pass the agent runs (pdftotext/pandoc/whisper).
        // Record it as pending so the work survives this process and shows up in the ledger.
        record(entries, { source: p, sha256: hash, fetched: new Date().toISOString(), raw: "" });
        pending++;
        console.log(`  pending extraction: ${p}`);
      }
    }
  }
  if (skipped) console.log(`  ${skipped} unchanged, skipped`);
  if (fromCache) console.log(`  ${fromCache} from the extraction cache (inbox/extracted/)`);
  if (pending) console.log(`  ${pending} awaiting CLI extraction — see skills/ingest/SKILL.md`);
}
