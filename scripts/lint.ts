// khb lint — enforce lint.md (structural rules + OKF v0.1 conformance) across the hub
import { HUB, BUNDLES, listBundles, read, mdLinks, refTargets, join, existsSync } from "./lib/util";
import { readdirSync, statSync } from "node:fs";
import { dirname, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { makeResolver } from "./lib/concepts";

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

for (const b of bundles) {
  const dir = join(BUNDLES, b);

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

  // One definition of "what a link points at", shared with the split machinery.
  const resolveIn = makeResolver(dir);

  const meta = new Map<string, { fm: any; body: string }>();
  for (const c of concepts) {
    const body = read(join(dir, c));

    // L9 OKF conformance: frontmatter with non-empty type
    const fm = body.match(/^---\n([\s\S]*?)\n---/)?.[1];
    if (!fm) err("L9", `${b}: ${c} has no YAML frontmatter (OKF requires it)`);
    else if (!/^type:\s*\S/m.test(fm)) err("L9", `${b}: ${c} frontmatter missing required 'type'`);

    let parsed: any = null;
    if (fm) try { parsed = parseYaml(fm); } catch { /* L9 shape is checked above */ }
    meta.set(c, { fm: parsed, body });

    // L6 no cross-bundle links from concept docs
    for (const l of mdLinks(stripComments(body))) {
      if (/(^|\/)bundles\//.test(l.target) || l.target.startsWith("../../")) {
        err("L6", `${b}: ${c} links into another bundle (${l.target}) — use refs.md`);
        continue;
      }
      // L12 in-bundle links resolve. The usual cause is a doc that left the bundle
      // (see `khb split --only-tagged`); the link must become prose + a refs.md pointer.
      const r = resolveIn(c, l.target);
      if (r && !existsSync(join(dir, r)))
        warn("L12", `${b}: ${c} links to missing ${r} — left the bundle? rewrite it as prose + refs.md`);
    }
  }

  // L10/L11 derived answers (query.md fold 2): provenance resolves, and doesn't go stale
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  for (const [c, { fm, body }] of meta) {
    const df = fm?.derived_from;
    if (df == null) continue;
    const sources = (Array.isArray(df) ? df : [df]).map(String).filter(Boolean);
    if (!sources.length) continue;

    const ts = Date.parse(String(fm?.timestamp ?? ""));
    if (Number.isNaN(ts))
      warn("L11", `${b}: ${c} has derived_from but no parsable 'timestamp' — cannot check staleness`);

    const linked = new Set(
      mdLinks(stripComments(body)).map((l) => resolveIn(c, l.target)).filter(Boolean) as string[],
    );
    let anyLinked = false;

    for (const s of sources) {
      const target = resolveIn(c, s);
      if (!target || !existsSync(join(dir, target))) {
        warn("L10", `${b}: ${c} derived_from '${s}' does not resolve inside the bundle`);
        continue;
      }
      if (linked.has(target)) anyLinked = true;
      const sts = Date.parse(String(meta.get(target)?.fm?.timestamp ?? ""));
      if (!Number.isNaN(ts) && !Number.isNaN(sts) && sts > ts)
        warn("L11", `${b}: ${c} may be stale — source ${target} is newer (${day(sts)} > ${day(ts)})`);
    }

    if (!anyLinked)
      warn("L10", `${b}: ${c} links to none of its derived_from sources — orphaned derivation`);
  }

  // L7 ref targets exist
  if (existsSync(join(dir, "refs.md"))) {
    for (const t of refTargets(read(join(dir, "refs.md"))))
      if (!bundles.includes(t)) err("L7", `${b}: refs.md targets missing bundle '${t}'`);
  }

  // L8 raw provenance (warning)
  const rawDir = join(dir, "raw");
  if (existsSync(rawDir)) {
    for (const f of readdirSync(rawDir, { recursive: true }) as string[]) {
      try {
        if (f.endsWith(".md") && !read(join(rawDir, f)).startsWith("---"))
          warn("L8", `${b}: raw/${f} missing provenance header`);
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

console.log(`\nlint: ${errors} error(s), ${warnings} warning(s) across ${bundles.length} bundle(s)`);
process.exit(errors ? 1 : 0);
