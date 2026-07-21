// Local folder → raw/folder/. Text-ish files copied with provenance; binaries recorded
// in the ledger as pending extraction. Unchanged files (same content hash, raw/ copy
// still present) are skipped.
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { writeRaw, sha256File, join } from "../lib/util";
import { record, isFresh, type Entry } from "../lib/ledger";
import { extractedPath, extractedBody } from "../lib/extract";
import { kindOf, mdName } from "./exts";
import type { Source } from "./index";

export async function ingestFolder(
  s: Extract<Source, { type: "folder" }>,
  rawDir: string,
  bundleDir: string,
  entries: Map<string, Entry>,
  force: boolean,
) {
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });

  let skipped = 0, pending = 0, fromCache = 0;
  for (const p of walk(s.path)) {
    const kind = kindOf(p);
    if (kind === "skip") continue;
    const rel = p.slice(s.path.length + 1);
    const hash = await sha256File(p);
    if (!force && isFresh(entries, bundleDir, p, hash)) {
      skipped++;
      continue;
    }
    const name = mdName(rel.replaceAll(/[\\/]/g, "__"));
    const cached = extractedPath(hash); // filled by `khb catalog`; keyed by content hash
    if (kind === "text") {
      const raw = writeRaw(rawDir, name, p, readFileSync(p, "utf8"));
      record(entries, { source: p, sha256: hash, fetched: new Date().toISOString(), raw });
    } else if (existsSync(cached)) {
      const raw = writeRaw(rawDir, name, p, extractedBody(cached));
      record(entries, { source: p, sha256: hash, fetched: new Date().toISOString(), raw });
      fromCache++;
    } else {
      record(entries, { source: p, sha256: hash, fetched: new Date().toISOString(), raw: "" });
      pending++;
      console.log(`  extractable — agent: convert via CLI per skills/ingest/SKILL.md: "${p}"`);
    }
  }
  if (skipped) console.log(`  ${skipped} unchanged, skipped`);
  if (fromCache) console.log(`  ${fromCache} from the extraction cache (inbox/extracted/)`);
  if (pending) console.log(`  ${pending} awaiting CLI extraction`);
}
