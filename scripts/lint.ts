// khb lint — enforce skills/lint/SKILL.md (structural rules + OKF v0.1 conformance) across the hub
import { HUB, BUNDLES, listBundles, read, mdLinks, refTargets, join, existsSync } from "./lib/util";
import { readLedger } from "./lib/ledger";
import { detail, section, totalElapsed } from "./lib/log";
import { readdirSync, statSync } from "node:fs";
import { dirname, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { rejectUnknownFlags } from "./lib/args";

rejectUnknownFlags(process.argv.slice(2), "khb lint");

/** OKF v0.1 concept frontmatter. Unknown keys are warned, not rejected — OKF is permissive,
 *  but a `titel:` typo silently loses the field, so it is worth one line of noise. */
const OKF_FIELDS = new Set(["type", "title", "description", "resource", "tags", "timestamp"]);

/** Accepts a YAML-parsed Date (unquoted) or an ISO-8601 string (quoted). */
const isTimestamp = (value: unknown) =>
  value instanceof Date
    ? !isNaN(value.getTime())
    : typeof value === "string" && !isNaN(Date.parse(value));

let errors = 0, warnings = 0;
const err = (rule: string, msg: string) => { errors++; console.error(`ERROR ${rule}: ${msg}`); };
const warn = (rule: string, msg: string) => { warnings++; console.warn(`warn  ${rule}: ${msg}`); };

/**
 * Drop everything that is markup *about* markdown rather than markdown: HTML comments, and
 * every code span or fenced block.
 *
 * Code has to go before any link is extracted. A doc explaining the index form writes
 * `` `* [Title](path.md) - description` `` as an example, and a link rule that cannot tell
 * an example from a link reports it as a dead one — which in a project whose concept docs
 * document its own conventions is a false positive on exactly the docs most worth writing.
 * The same reasoning covers L6: a code sample *showing* a forbidden cross-bundle link is
 * teaching the rule, not breaking it.
 *
 * One pattern handles spans and fences alike: a run of N backticks closes on the next run
 * of exactly N, so ``` fences and the `` `…` `` form that quotes inner backticks both pair
 * correctly. An unbalanced backtick simply fails to match and leaves the text alone.
 */
const stripNonProse = (markdown: string) =>
  markdown.replace(/<!--[\s\S]*?-->/g, "").replace(/(`+)[\s\S]*?\1/g, "");

const RESERVED = ["index.md", "log.md", "refs.md"]; // refs.md is KHB-reserved
const bundles = listBundles();
const outerIndex = read(join(HUB, "outer.index.md"));

/** All files under dir (relative paths), skipping raw/. */
function walk(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((entry: string) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "raw" ? [] : walk(path, base);
    return [relative(base, path).replaceAll("\\", "/")];
  });
}

/**
 * A markdown link target resolved to a path relative to the bundle root, or undefined when
 * it names nothing in this bundle's files: an external URL, a `mailto:`, or a bare `#anchor`
 * pointing inside the linking document itself.
 *
 * `/from/bundle/root.md` is the form AGENTS.md prefers; anything else is relative to the
 * file doing the linking. A trailing `#section` names a place *within* the target, not a
 * different file, so it is dropped before the path is resolved — without that, every
 * `[text](concept.md#heading)` reads as a link to a file that does not exist.
 */
function resolveLink(bundleRoot: string, fromRelative: string, target: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) return undefined;
  const path = target.split("#")[0].split("?")[0].trim();
  if (!path) return undefined;
  const resolved = path.startsWith("/")
    ? path.slice(1)
    : relative(bundleRoot, join(bundleRoot, dirname(fromRelative), path)).replaceAll("\\", "/");
  return resolved.replace(/\/$/, "");
}

console.log(`khb lint → ${HUB}`);
detail(`${bundles.length} bundle(s): ${bundles.join(", ") || "none"}`);

for (const [bundleIndex, bundle] of bundles.entries()) {
  const dir = join(BUNDLES, bundle);
  // Name the bundle before its findings: an unattributed "ERROR L4" in a fifty-bundle hub
  // sends you grepping, and a clean bundle should still show that it was actually checked.
  section(`[${bundleIndex + 1}/${bundles.length}] ${bundle}`);

  // L2 name
  if (!/^[a-z0-9][a-z0-9-]*$/.test(bundle)) err("L2", `bad bundle name '${bundle}'`);

  // L1 required files
  for (const required of ["index.md", "refs.md", "sources.yaml"])
    if (!existsSync(join(dir, required))) err("L1", `${bundle}: missing ${required}`);

  // L3 registered in outer index
  if (!outerIndex.includes(`bundles/${bundle}/`))
    err("L3", `${bundle}: not listed in outer.index.md`);

  const files = existsSync(dir) ? walk(dir) : [];
  const mdFiles = files.filter((file) => file.endsWith(".md"));
  const concepts = mdFiles.filter((file) => !RESERVED.includes(file.split("/").pop()!));
  const indexes = mdFiles.filter((file) => file.split("/").pop() === "index.md");
  detail(`${concepts.length} concept doc(s), ${indexes.length} index file(s)`);

  // Collect all index link targets, resolved to bundle-relative paths
  const indexed = new Set<string>();
  for (const indexFile of indexes) {
    const markdown = stripNonProse(read(join(dir, indexFile)));
    for (const link of mdLinks(markdown)) {
      const resolved = resolveLink(dir, indexFile, link.target);
      if (resolved === undefined) continue;
      indexed.add(resolved);
      // L4b index links resolve (warning — OKF tolerates not-yet-written knowledge)
      if (!existsSync(join(dir, resolved)))
        warn("L4", `${bundle}: ${indexFile} links to missing ${resolved}`);
    }
  }

  // L4a every concept is indexed somewhere
  for (const concept of concepts)
    if (!indexed.has(concept)) err("L4", `${bundle}: ${concept} not listed in any index.md`);

  for (const concept of concepts) {
    const body = read(join(dir, concept));

    // L9 OKF conformance: frontmatter must parse and carry a usable field set.
    // Frontmatter is the machine-readable half of a concept — routing, filtering and any
    // future index generator read it — so a typo'd key is a silent data loss, not a style nit.
    const frontmatter = body.match(/^---\n([\s\S]*?)\n---/)?.[1];
    if (frontmatter === undefined)
      err("L9", `${bundle}: ${concept} has no YAML frontmatter (OKF requires it)`);
    else {
      let meta: Record<string, unknown> | undefined;
      try {
        meta = (parseYaml(frontmatter) ?? {}) as Record<string, unknown>;
      } catch (error) {
        err(
          "L9",
          `${bundle}: ${concept} frontmatter is not valid YAML — ${(error as Error).message.split("\n")[0]}`,
        );
      }
      if (meta) {
        const str = (key: string) =>
          typeof meta![key] === "string" ? (meta![key] as string).trim() : "";
        // type is the one OKF hard requirement; the rest degrade to warnings so an
        // in-progress hub still lints clean while its authors fill things in.
        if (!str("type")) err("L9", `${bundle}: ${concept} frontmatter missing required 'type'`);
        for (const key of ["title", "description"])
          if (!str(key)) warn("L9", `${bundle}: ${concept} frontmatter missing '${key}'`);
        if ("tags" in meta && !Array.isArray(meta.tags))
          err("L9", `${bundle}: ${concept} 'tags' must be a YAML list, not ${typeof meta.tags}`);
        if (Array.isArray(meta.tags) && meta.tags.some((tag) => typeof tag !== "string"))
          err("L9", `${bundle}: ${concept} 'tags' must contain only strings`);
        if ("timestamp" in meta && !isTimestamp(meta.timestamp))
          warn("L9", `${bundle}: ${concept} 'timestamp' is not an ISO-8601 datetime`);
        for (const key of Object.keys(meta))
          if (!OKF_FIELDS.has(key)) warn("L9", `${bundle}: ${concept} unknown frontmatter key '${key}'`);
      }
    }

    // L6 no cross-bundle links from concept docs
    for (const link of mdLinks(stripNonProse(body))) {
      if (/(^|\/)bundles\//.test(link.target) || link.target.startsWith("../../")) {
        err("L6", `${bundle}: ${concept} links into another bundle (${link.target}) — use refs.md`);
        continue;
      }
      // L11 in-bundle concept links resolve. Concepts link to each other as the bundle's
      // actual structure — the catalog cross-link pass and the query skill's back-links to
      // a synthesis's sources both live in these links, and a synthesis nobody can reach
      // from its sources is a dead end. Only the index side of this was ever checked.
      // A warning, like L4b and for the same reason: a link to a concept somebody intends
      // to write next is not-yet-written knowledge, which OKF tolerates by design.
      const resolved = resolveLink(dir, concept, link.target);
      if (resolved !== undefined && !existsSync(join(dir, resolved)))
        warn("L11", `${bundle}: ${concept} links to missing ${resolved}`);
    }
  }

  // L7 ref targets exist
  if (existsSync(join(dir, "refs.md"))) {
    for (const target of refTargets(read(join(dir, "refs.md"))))
      if (!bundles.includes(target)) err("L7", `${bundle}: refs.md targets missing bundle '${target}'`);
  }

  // Enumerated once, bundle-relative (`raw/<type>/<file>.md`) — the spelling the ledger
  // stores, so L10 can compare the two sides without renormalizing on every row.
  const rawDir = join(dir, "raw");
  const rawFiles = existsSync(rawDir)
    ? (readdirSync(rawDir, { recursive: true }) as string[])
        .filter((file) => file.endsWith(".md"))
        .map((file) => `raw/${file.replaceAll("\\", "/")}`)
    : [];

  // L8 raw provenance (warning)
  if (rawFiles.length) {
    detail(`${rawFiles.length} raw/ file(s) checked for provenance`);
    for (const rawFile of rawFiles) {
      try {
        const head = read(join(dir, rawFile));
        const provenance = head.match(/^---\n([\s\S]*?)\n---/)?.[1];
        if (provenance === undefined) {
          warn("L8", `${bundle}: ${rawFile} missing provenance header`);
          continue;
        }
        // `source` is the whole point of the header: it is how a bad extraction gets re-read.
        if (!/^source:\s*\S/m.test(provenance))
          warn("L8", `${bundle}: ${rawFile} provenance missing 'source'`);
        const quality = provenance.match(/^quality:\s*(\S+)/m)?.[1];
        if (quality && quality !== "high" && quality !== "low")
          warn("L8", `${bundle}: ${rawFile} quality '${quality}' is not high|low`);
      } catch {}
    }
  }

  // L10 ledger integrity. log.md is the durable record across both halves of the workflow,
  // and its empty `curated` cells *are* the catalog backlog — but nothing has ever checked
  // that its paths still name anything, so a concept renamed after cataloging leaves a row
  // claiming work that can no longer be found, and neither side notices.
  const ledger = readLedger(dir);
  if (ledger.size) {
    detail(`${ledger.size} log.md row(s) checked`);
    const claimed = new Set<string>();
    for (const row of ledger.values()) {
      if (row.raw) {
        claimed.add(row.raw);
        // raw/ is gitignored and re-derivable, so a hub that was cloned rather than ingested
        // legitimately has every row and no files at all. Only hold a row to its raw file
        // once raw/ has actually been populated; an empty one is that ordinary state.
        if (rawFiles.length && !existsSync(join(dir, row.raw)))
          warn("L10", `${bundle}: log.md row '${row.source}' names missing ${row.raw}`);
      }
      // `declined` is the documented way to close a row without writing a concept
      // (skills/catalog/SKILL.md §5); anything else is a path the row claims to have written.
      // An error, unlike the link rules: there is no not-yet-written case here, since the
      // column is only filled once the concept exists.
      if (row.curated && row.curated !== "declined") {
        const curatedPaths = row.curated.split(",").map((path) => path.trim()).filter(Boolean);
        for (const curated of curatedPaths)
          if (!existsSync(join(dir, curated)))
            err("L10", `${bundle}: log.md row '${row.source}' claims missing concept ${curated}`);
      }
    }
    // An extracted file no row names is invisible work: it is not offered as backlog, so it
    // stays uncurated without ever appearing to be outstanding.
    for (const rawFile of rawFiles)
      if (!claimed.has(rawFile)) warn("L10", `${bundle}: ${rawFile} has no log.md row`);
  } else if (rawFiles.length) {
    warn("L10", `${bundle}: ${rawFiles.length} file(s) in raw/ but log.md records none of them`);
  }
}

// L3 reverse: outer index entries exist
for (const link of mdLinks(outerIndex)) {
  const match = link.target.match(/^bundles\/([a-z0-9-]+)\//);
  if (match && !bundles.includes(match[1]))
    err("L3", `outer.index.md lists missing bundle '${match[1]}'`);
}

// L5 index prose check (rough): paragraph-length prose in index files
function proseCheck(name: string, markdown: string) {
  for (const block of stripNonProse(markdown).split(/\n\s*\n/)) {
    const text = block.trim();
    if (!text || /^[#|\-*]/.test(text) || text.startsWith("---")) continue;
    if (text.split(/\s+/).length > 30)
      warn("L5", `${name}: paragraph-length prose in an index file`);
  }
}
proseCheck("outer.index.md", outerIndex);
for (const bundle of bundles)
  if (existsSync(join(BUNDLES, bundle, "index.md")))
    proseCheck(`${bundle}/index.md`, read(join(BUNDLES, bundle, "index.md")));

console.log(`\nlint: ${errors} error(s), ${warnings} warning(s) across ${bundles.length} bundle(s) in ${totalElapsed()}`);
