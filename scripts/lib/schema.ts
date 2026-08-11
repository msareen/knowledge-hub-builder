// The current shape of bundles/<b>/sources.yaml, and a comment-preserving diff/apply against
// it. Not a persisted schema-version: the "schema" is just this file's current field lists,
// checked fresh every run — same as MANAGED/RETIRED in paths.ts are static lists re-checked on
// every upgrade rather than tracked historically. Deliberately excludes util.ts, so it can be
// imported from lib/upgrade.ts, which must resolve before a hub is.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument, isMap, isSeq, YAMLMap } from "yaml";

export type FieldSchema = { key: string; default: unknown } | { key: string; deprecated: true };

/**
 * Optional, backfillable fields per source `type`. Required fields (`path`, `paths`, `urls`)
 * are not listed here — a missing one is already a hard validation error in
 * scripts/ingest/index.ts, not something to silently default.
 */
export const SOURCES_SCHEMA: Record<string, FieldSchema[]> = {
  folder: [{ key: "exclude", default: [] }],
  files: [{ key: "exclude", default: [] }],
  web: [],
};

export type SourcesDiff = { path: string; doc: ReturnType<typeof parseDocument>; changes: string[] };

/** Every bundle directory under a hub, without going through util.ts's HUB singleton. */
export function listBundleDirs(hub: string): string[] {
  const dir = join(hub, "bundles");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((d) => join(dir, d))
    .filter((d) => statSync(d).isDirectory());
}

/** Diff one bundle's sources.yaml against SOURCES_SCHEMA. Null if there's nothing to change. */
export function diffSourcesYaml(bundleDir: string): SourcesDiff | null {
  const path = join(bundleDir, "sources.yaml");
  if (!existsSync(path)) return null;
  const doc = parseDocument(readFileSync(path, "utf8"));
  const sources = doc.get("sources");
  if (!isSeq(sources)) return null;

  const changes: string[] = [];
  sources.items.forEach((item, i) => {
    if (!isMap(item)) return;
    const type = item.get("type");
    if (typeof type !== "string") return;
    const fields = SOURCES_SCHEMA[type];
    if (!fields) return;
    for (const field of fields) {
      if ("deprecated" in field) {
        if (item.has(field.key)) {
          item.delete(field.key);
          changes.push(`sources[${i}] (${type}): remove deprecated '${field.key}'`);
        }
      } else if (!item.has(field.key)) {
        (item as YAMLMap).set(field.key, field.default);
        changes.push(`sources[${i}] (${type}): add '${field.key}: ${JSON.stringify(field.default)}'`);
      }
    }
  });

  return changes.length ? { path, doc, changes } : null;
}

/** Diff every bundle in a hub. */
export function diffSourcesYamlAll(hub: string): SourcesDiff[] {
  return listBundleDirs(hub)
    .map(diffSourcesYaml)
    .filter((d): d is SourcesDiff => d !== null);
}

/** Write a diff's staged changes back to disk. */
export function applySourcesDiff(diff: SourcesDiff): void {
  writeFileSync(diff.path, diff.doc.toString());
}
