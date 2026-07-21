import { readdirSync, readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, basename, dirname, resolve } from "node:path";
import { MARKER, MARKERS } from "./paths";
import { DEFAULT_PRIMARY } from "./scaffold";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** A hub is any folder carrying a marker — the current one, or the pre-rename one. */
function isHub(dir: string): boolean {
  return MARKERS.some((m) => existsSync(join(dir, m)));
}

/**
 * Find the hub root — the folder holding khb.json, outer.index.md and bundles/.
 * It is the user's knowledge, and lives wherever they put it; the khb package holds
 * no knowledge of its own. Precedence: $KHB_HUB (set from --hub by cli.ts) > nearest
 * ancestor of cwd containing the marker.
 */
function resolveHub(): string {
  const explicit = process.env.KHB_HUB ?? process.env.BKR_HUB;
  if (explicit) {
    const dir = resolve(explicit);
    if (!isHub(dir)) {
      console.error(`Not a KHB hub (no ${MARKER}): ${dir}`);
      process.exit(1);
    }
    return dir;
  }
  for (let dir = process.cwd(); ; ) {
    if (isHub(dir)) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  console.error(`No KHB hub found in ${process.cwd()} or any parent directory.`);
  console.error(`Create one:   khb init <dir>`);
  console.error(`Or point at an existing one:   khb --hub <dir> <command>   (or set $KHB_HUB)`);
  process.exit(1);
}

export const HUB = resolveHub();

/** The marker this hub actually carries — `khb.json`, or a legacy `bkr.json`. */
export function markerPath(hub: string = HUB): string {
  return join(hub, MARKERS.find((m) => existsSync(join(hub, m))) ?? MARKER);
}

export const BUNDLES = join(HUB, "bundles");
export const INBOX = join(HUB, "inbox");
export { TEMPLATE } from "./paths";

export function listBundles(): string[] {
  if (!existsSync(BUNDLES)) return [];
  return readdirSync(BUNDLES).filter((d) => statSync(join(BUNDLES, d)).isDirectory());
}

export function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * The hub's primary bundle — where material lands when nothing says otherwise.
 * Declared as `"primary"` in khb.json; `khb init` creates it. A hub that predates the
 * key, or whose primary was renamed away, falls back to whatever exists.
 */
export function primaryBundle(): string | undefined {
  let declared: string | undefined;
  try {
    declared = JSON.parse(read(markerPath()))?.primary;
  } catch {}
  const bundles = listBundles();
  if (declared && bundles.includes(declared)) return declared;
  if (bundles.includes(DEFAULT_PRIMARY)) return DEFAULT_PRIMARY;
  return undefined;
}

/**
 * Merge absolute paths into a bundle's `sources.yaml` as its `files` source — the one
 * write shared by `khb triage` and `khb split`. Copies nothing; `khb ingest` acquires.
 */
export function addFilesSource(bundle: string, paths: string[]): { added: number; total: number } {
  const sp = join(BUNDLES, bundle, "sources.yaml");
  const text = read(sp);
  // Preserve the leading comment block; the rest is regenerated from parsed data.
  const preamble = text.split("\n").filter((l) => l.startsWith("#")).join("\n");
  const cfg = (parseYaml(text) ?? {}) as { sources?: any[] };
  const sources = cfg.sources ?? [];

  let filesSource = sources.find((s) => s?.type === "files");
  if (!filesSource) {
    filesSource = { type: "files", paths: [] };
    sources.push(filesSource);
  }
  const before = filesSource.paths?.length ?? 0;
  filesSource.paths = [...new Set([...(filesSource.paths ?? []), ...paths.map((p) => p.replaceAll("\\", "/"))])];

  writeFileSync(sp, preamble + "\n" + stringifyYaml({ ...cfg, sources }));
  return { added: filesSource.paths.length - before, total: filesSource.paths.length };
}

/** All markdown link targets in a file: [text](target) */
export function mdLinks(md: string): { text: string; target: string }[] {
  const out: { text: string; target: string }[] = [];
  for (const m of md.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)) out.push({ text: m[1], target: m[2] });
  return out;
}

/** Bundle names mentioned in a refs.md table (first column). */
export function refTargets(refsMd: string): string[] {
  const out: string[] = [];
  for (const line of refsMd.split("\n")) {
    const m = line.match(/^\|\s*\[?([a-z0-9][a-z0-9-]*)\]?[^|]*\|/);
    if (m && !["bundle", "---"].includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Write a raw/ file with provenance front matter. Returns its bundle-relative path. */
export function writeRaw(dir: string, name: string, source: string, body: string): string {
  mkdirSync(dir, { recursive: true });
  const safe = name.replace(/[^\w.-]+/g, "_");
  const fm = `---\nsource: ${source}\nfetched: ${new Date().toISOString()}\n---\n\n`;
  writeFileSync(join(dir, safe), fm + body);
  console.log(`  raw/ <- ${safe}`);
  // dir is <bundle>/raw/<type>; report the path as the ledger stores it
  const type = basename(dir);
  return `raw/${type}/${safe}`;
}

export const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");

/** Hash a file in chunks — corpora contain multi-GB binaries we must not slurp. */
export async function sha256File(path: string): Promise<string> {
  const h = createHash("sha256");
  const stream = (await import("node:fs")).createReadStream(path, { highWaterMark: 1 << 20 });
  for await (const chunk of stream) h.update(chunk as Buffer);
  return h.digest("hex");
}

export function bundleDir(name: string): string {
  const dir = join(BUNDLES, name);
  if (!existsSync(dir)) {
    console.error(`No such bundle: ${name}`);
    process.exit(1);
  }
  return dir;
}

export { join, basename, existsSync, mkdirSync };
