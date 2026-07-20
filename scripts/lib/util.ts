import { readdirSync, readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, basename, dirname, resolve } from "node:path";
import { MARKER } from "./paths";

/**
 * Find the hub root — the folder holding bkr.json, outer.index.md and bundles/.
 * It is the user's knowledge, and lives wherever they put it; the bkr package holds
 * no knowledge of its own. Precedence: $BKR_HUB (set from --hub by cli.ts) > nearest
 * ancestor of cwd containing the marker.
 */
function resolveHub(): string {
  const explicit = process.env.BKR_HUB;
  if (explicit) {
    const dir = resolve(explicit);
    if (!existsSync(join(dir, MARKER))) {
      console.error(`Not a BKR hub (no ${MARKER}): ${dir}`);
      process.exit(1);
    }
    return dir;
  }
  for (let dir = process.cwd(); ; ) {
    if (existsSync(join(dir, MARKER))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  console.error(`No BKR hub found in ${process.cwd()} or any parent directory.`);
  console.error(`Create one:   bkr init <dir>`);
  console.error(`Or point at an existing one:   bkr --hub <dir> <command>   (or set $BKR_HUB)`);
  process.exit(1);
}

export const HUB = resolveHub();
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
