import { readdirSync, readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, basename } from "node:path";

export const ROOT = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
export const BUNDLES = join(ROOT, "bundles");
export const TEMPLATE = join(ROOT, ".bundle_template");
export const INBOX = join(ROOT, "inbox");

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
