// khb lint — enforce skills/lint/SKILL.md (structural rules + OKF v0.1 conformance) across the hub
import { HUB, BUNDLES, listBundles, read, mdLinks, refTargets, join, existsSync } from "./lib/util";
import { detail, section, totalElapsed } from "./lib/log";
import { readdirSync, statSync } from "node:fs";
import { dirname, relative } from "node:path";
import { parse as parseYaml } from "yaml";

/** OKF v0.1 concept frontmatter. Unknown keys are warned, not rejected — OKF is permissive,
 *  but a `titel:` typo silently loses the field, so it is worth one line of noise. */
const OKF_FIELDS = new Set(["type", "title", "description", "resource", "tags", "timestamp"]);

/** Accepts a YAML-parsed Date (unquoted) or an ISO-8601 string (quoted). */
const isTimestamp = (v: unknown) =>
  v instanceof Date ? !isNaN(v.getTime()) : typeof v === "string" && !isNaN(Date.parse(v));

let errors = 0, warnings = 0;
const err = (rule: string, msg: string) => { errors++; console.error(`ERROR ${rule}: ${msg}`); };
const warn = (rule: string, msg: string) => { warnings++; console.warn(`warn  ${rule}: ${msg}`); };

const stripComments = (md: string) => md.replace(/<!--[\s\S]*?-->/g, "");
const RESERVED = ["index.md", "log.md", "refs.md"]; // refs.md is KHB-reserved
const bundles = listBundles();
const outerIndex = read(join(HUB, "outer.index.md"));

/** All files under dir (relative paths), skipping raw/. */
function walk(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "raw" ? [] : walk(p, base);
    return [relative(base, p).replaceAll("\\", "/")];
  });
}

console.log(`khb lint → ${HUB}`);
detail(`${bundles.length} bundle(s): ${bundles.join(", ") || "none"}`);

for (const [bi, b] of bundles.entries()) {
  const dir = join(BUNDLES, b);
  // Name the bundle before its findings: an unattributed "ERROR L4" in a fifty-bundle hub
  // sends you grepping, and a clean bundle should still show that it was actually checked.
  section(`[${bi + 1}/${bundles.length}] ${b}`);

  // L2 name
  if (!/^[a-z0-9][a-z0-9-]*$/.test(b)) err("L2", `bad bundle name '${b}'`);

  // L1 required files
  for (const f of ["index.md", "refs.md", "sources.yaml"])
    if (!existsSync(join(dir, f))) err("L1", `${b}: missing ${f}`);

  // L3 registered in outer index
  if (!outerIndex.includes(`bundles/${b}/`)) err("L3", `${b}: not listed in outer.index.md`);

  const files = existsSync(dir) ? walk(dir) : [];
  const mdFiles = files.filter((f) => f.endsWith(".md"));
  const concepts = mdFiles.filter((f) => !RESERVED.includes(f.split("/").pop()!));
  const indexes = mdFiles.filter((f) => f.split("/").pop() === "index.md");
  detail(`${concepts.length} concept doc(s), ${indexes.length} index file(s)`);

  // Collect all index link targets, resolved to bundle-relative paths
  const indexed = new Set<string>();
  for (const idx of indexes) {
    const md = stripComments(read(join(dir, idx)));
    for (const l of mdLinks(md)) {
      if (l.target.startsWith("http")) continue;
      const resolved = l.target.startsWith("/")
        ? l.target.slice(1)
        : relative(dir, join(dir, dirname(idx), l.target)).replaceAll("\\", "/");
      indexed.add(resolved.replace(/\/$/, ""));
      // L4b index links resolve (warning — OKF tolerates not-yet-written knowledge)
      if (!existsSync(join(dir, resolved)))
        warn("L4", `${b}: ${idx} links to missing ${resolved}`);
    }
  }

  // L4a every concept is indexed somewhere
  for (const c of concepts)
    if (!indexed.has(c)) err("L4", `${b}: ${c} not listed in any index.md`);

  for (const c of concepts) {
    const body = read(join(dir, c));

    // L9 OKF conformance: frontmatter must parse and carry a usable field set.
    // Frontmatter is the machine-readable half of a concept — routing, filtering and any
    // future index generator read it — so a typo'd key is a silent data loss, not a style nit.
    const fm = body.match(/^---\n([\s\S]*?)\n---/)?.[1];
    if (fm === undefined) err("L9", `${b}: ${c} has no YAML frontmatter (OKF requires it)`);
    else {
      let meta: Record<string, unknown> | undefined;
      try {
        meta = (parseYaml(fm) ?? {}) as Record<string, unknown>;
      } catch (e) {
        err("L9", `${b}: ${c} frontmatter is not valid YAML — ${(e as Error).message.split("\n")[0]}`);
      }
      if (meta) {
        const str = (k: string) => (typeof meta![k] === "string" ? (meta![k] as string).trim() : "");
        // type is the one OKF hard requirement; the rest degrade to warnings so an
        // in-progress hub still lints clean while its authors fill things in.
        if (!str("type")) err("L9", `${b}: ${c} frontmatter missing required 'type'`);
        for (const k of ["title", "description"])
          if (!str(k)) warn("L9", `${b}: ${c} frontmatter missing '${k}'`);
        if ("tags" in meta && !Array.isArray(meta.tags))
          err("L9", `${b}: ${c} 'tags' must be a YAML list, not ${typeof meta.tags}`);
        if (Array.isArray(meta.tags) && meta.tags.some((t) => typeof t !== "string"))
          err("L9", `${b}: ${c} 'tags' must contain only strings`);
        if ("timestamp" in meta && !isTimestamp(meta.timestamp))
          warn("L9", `${b}: ${c} 'timestamp' is not an ISO-8601 datetime`);
        for (const k of Object.keys(meta))
          if (!OKF_FIELDS.has(k)) warn("L9", `${b}: ${c} unknown frontmatter key '${k}'`);
      }
    }

    // L6 no cross-bundle links from concept docs
    for (const l of mdLinks(stripComments(body))) {
      if (/(^|\/)bundles\//.test(l.target) || l.target.startsWith("../../"))
        err("L6", `${b}: ${c} links into another bundle (${l.target}) — use refs.md`);
    }
  }

  // L7 ref targets exist
  if (existsSync(join(dir, "refs.md"))) {
    for (const t of refTargets(read(join(dir, "refs.md"))))
      if (!bundles.includes(t)) err("L7", `${b}: refs.md targets missing bundle '${t}'`);
  }

  // L8 raw provenance (warning)
  const rawDir = join(dir, "raw");
  if (existsSync(rawDir)) {
    const rawFiles = (readdirSync(rawDir, { recursive: true }) as string[]).filter((f) => f.endsWith(".md"));
    detail(`${rawFiles.length} raw/ file(s) checked for provenance`);
    for (const f of readdirSync(rawDir, { recursive: true }) as string[]) {
      try {
        if (!f.endsWith(".md")) continue;
        const head = read(join(rawDir, f));
        const rfm = head.match(/^---\n([\s\S]*?)\n---/)?.[1];
        if (rfm === undefined) { warn("L8", `${b}: raw/${f} missing provenance header`); continue; }
        // `source` is the whole point of the header: it is how a bad extraction gets re-read.
        if (!/^source:\s*\S/m.test(rfm)) warn("L8", `${b}: raw/${f} provenance missing 'source'`);
        const q = rfm.match(/^quality:\s*(\S+)/m)?.[1];
        if (q && q !== "high" && q !== "low")
          warn("L8", `${b}: raw/${f} quality '${q}' is not high|low`);
      } catch {}
    }
  }
}

// L3 reverse: outer index entries exist
for (const l of mdLinks(outerIndex)) {
  const m = l.target.match(/^bundles\/([a-z0-9-]+)\//);
  if (m && !bundles.includes(m[1])) err("L3", `outer.index.md lists missing bundle '${m[1]}'`);
}

// L5 index prose check (rough): paragraph-length prose in index files
function proseCheck(name: string, md: string) {
  for (const block of stripComments(md).split(/\n\s*\n/)) {
    const t = block.trim();
    if (!t || /^[#|\-*]/.test(t) || t.startsWith("---")) continue;
    if (t.split(/\s+/).length > 30) warn("L5", `${name}: paragraph-length prose in an index file`);
  }
}
proseCheck("outer.index.md", outerIndex);
for (const b of bundles)
  if (existsSync(join(BUNDLES, b, "index.md"))) proseCheck(`${b}/index.md`, read(join(BUNDLES, b, "index.md")));

console.log(`\nlint: ${errors} error(s), ${warnings} warning(s) across ${bundles.length} bundle(s) in ${totalElapsed()}`);
process.exit(errors ? 1 : 0);
