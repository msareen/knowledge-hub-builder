import { readdirSync, readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, basename, resolve } from "node:path";
import { MARKER, markerIn, findHub } from "./paths";

/**
 * Find the hub root — the folder holding khb.json, outer.index.md and bundles/.
 * It is the user's knowledge, and lives wherever they put it; the khb package holds
 * no knowledge of its own. Precedence: $KHB_HUB (set from --hub by cli.ts) > nearest
 * ancestor of cwd containing the marker.
 */
function resolveHub(): string {
  const found = findHub();
  if (found) return found;
  const explicit = process.env.KHB_HUB;
  if (explicit) {
    console.error(`Not a KHB hub (no ${MARKER}): ${resolve(explicit)}`);
    process.exit(1);
  }
  console.error(`No KHB hub found in ${process.cwd()} or any parent directory.`);
  console.error(`Create one:   khb init <dir>`);
  console.error(`Or point at an existing one:   khb --hub <dir> <command>   (or set $KHB_HUB)`);
  process.exit(1);
}

export const HUB = resolveHub();
export const BUNDLES = join(HUB, "bundles");
export const INGEST_CACHE = join(HUB, ".ingest-cache");
export { TEMPLATE, markerIn } from "./paths";

export function listBundles(): string[] {
  if (!existsSync(BUNDLES)) return [];
  return readdirSync(BUNDLES).filter((d) => statSync(join(BUNDLES, d)).isDirectory());
}

export function read(path: string): string {
  return readFileSync(path, "utf8");
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

/**
 * Provenance recorded on every raw/ file. `source` is the whole point of the phase:
 * extraction is sometimes lossy, so curation must always be able to walk back to the
 * original bytes. `tool` and `quality` say how much to trust what follows — `low` means
 * OCR or a transcript guessed at it, and re-reading the source is the remedy.
 */
export type RawMeta = {
  source: string;
  sha256?: string;
  tool?: string;
  quality?: "high" | "low";
};

const safeRawName = (name: string) => name.replace(/[^\w.-]+/g, "_") || "source.md";

/**
 * Keep the readable filename unless another source already owns it. The suffix is based on
 * source identity, not content, so identical bytes acquired from two origins retain honest
 * provenance instead of overwriting each other.
 */
export function rawNameFor(
  dir: string,
  name: string,
  source: string,
  entries: Iterable<{ source: string; raw: string }>,
): string {
  const safe = safeRawName(name);
  const rel = `raw/${basename(dir)}/${safe}`;
  const owner = [...entries].find((e) => e.raw === rel);
  if ((!owner || owner.source === source) && (owner || !existsSync(join(dir, safe)))) return safe;
  const stem = safe.toLowerCase().endsWith(".md") ? safe.slice(0, -3) : safe;
  return `${stem}--${sha256(source).slice(0, 12)}.md`;
}

/**
 * Write a raw/ file with provenance front matter. Returns its bundle-relative path.
 * Silent by design — the caller owns the per-file line, and knows the verb ("copied",
 * "extracted", "transcribed") that a write on its own cannot.
 */
export function writeRaw(dir: string, name: string, meta: RawMeta, body: string): string {
  mkdirSync(dir, { recursive: true });
  const safe = safeRawName(name);
  const fm =
    `---\nsource: ${JSON.stringify(meta.source)}\nfetched: ${new Date().toISOString()}\n` +
    (meta.sha256 ? `sha256: ${meta.sha256}\n` : "") +
    (meta.tool ? `extract_tool: ${JSON.stringify(meta.tool)}\n` : "") +
    (meta.quality ? `quality: ${meta.quality}\n` : "") +
    `---\n\n`;
  writeFileSync(join(dir, safe), fm + body);
  // dir is <bundle>/raw/<type>; report the path as the ledger stores it
  const type = basename(dir);
  return `raw/${type}/${safe}`;
}

/**
 * Correct the `source:` line of an already-written raw/ file, for when the same bytes turn
 * up at a new path. Only that one line moves: the body is unchanged by definition (same
 * hash), and rewriting the file wholesale would churn a diff for no reason.
 */
export function retargetRaw(bundleDir: string, rawRel: string, source: string): boolean {
  const p = join(bundleDir, rawRel);
  if (!existsSync(p)) return false;
  const text = readFileSync(p, "utf8");
  const end = text.indexOf("\n---", 3);
  if (!text.startsWith("---\n") || end === -1) return false; // no provenance header to fix
  const head = text.slice(0, end).replace(/^source:.*$/m, `source: ${JSON.stringify(source)}`);
  writeFileSync(p, head + text.slice(end));
  return true;
}

/**
 * One spelling of a path, for comparing two of them. Absolute, and case-folded on Windows,
 * where `D:\Corpus\Talk.mp4` and `d:/corpus/talk.mp4` are the same file.
 */
export const normPath = (p: string) =>
  process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p);

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
