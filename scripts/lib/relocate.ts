// Mechanical path rewriting for `khb update --path`: after a hub is moved, replace every literal
// reference to its old location with the new one.
//
// Strictly a conversion, not an interpretation — the same substring, in and out, with no
// judgement about what a path means. That is what keeps it in the CLI: the alternative is
// an agent reading each file and deciding, which for a byte-identical prefix swap is both
// slower and less reliable than a regex. See AGENTS.md, "Division of labor".
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ticker } from "./log";

/** Directories never walked: VCS internals, installed packages, regenerable caches. */
const SKIP_DIRS = new Set([".git", "node_modules", ".ingest-cache"]);

/** A file bigger than this is a corpus artefact, not something holding a path reference. */
const MAX_BYTES = 8 * 1024 * 1024;

export type Hit = { file: string; count: number };
export type RewriteResult = {
  scanned: number;
  hits: Hit[];
  /** Files that matched but could not be written — read-only, locked, gone. */
  failed: { file: string; reason: string }[];
};

function* walk(dir: string, root = dir): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory: nothing to rewrite in what we cannot open
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(p, root);
    } else if (e.isFile()) {
      yield p;
    }
  }
}

/** Heuristic, and the standard one: a NUL byte in the first block means not text. */
function readText(path: string): string | undefined {
  try {
    if (statSync(path).size > MAX_BYTES) return undefined;
    const buf = readFileSync(path);
    if (buf.subarray(0, 8192).includes(0)) return undefined;
    return buf.toString("utf8");
  } catch {
    return undefined;
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The spellings one path takes in a hub's files, in a fixed order. A Windows path appears
 * natively (`D:\a\b`), with forward slashes (`D:/a/b`, common in YAML people typed by
 * hand), and backslash-escaped inside JSON — which is exactly how `raw/` provenance
 * headers and `log.md` store a source. All are the same location and all must move.
 * The order is what lets a matched spelling be mapped back to the same spelling of the
 * new path, so a JSON-escaped source stays JSON-escaped after the rewrite.
 */
function spellings(path: string): string[] {
  const back = path.replace(/\//g, "\\");
  return [back.replace(/\\/g, "\\\\"), back, path.replace(/\\/g, "/")];
}

/**
 * Pair every spelling of every old path with the matching spelling of the new one.
 *
 * Several old paths, not one, because the same directory has more than one true name:
 * a hub registered as `C:\Users\MANASV~1\…` and later canonicalized to
 * `C:\Users\Manasvi Sareen\…` has both strings sitting in files written at different
 * times, and a repair that fixed only the canonical one would leave the rest dangling.
 */
function pairs(froms: string[], to: string): { find: string; replace: string }[] {
  const out = new Map<string, string>();
  const news = spellings(to);
  for (const from of froms) {
    spellings(from).forEach((form, i) => {
      if (form && !out.has(form)) out.set(form, news[i]);
    });
  }
  // The new path also maps to itself. Two cases need it, and both are ordinary moves:
  // a hub lifted out of its parent (`…/kb/hub` → `…/kb`) and one pushed down into a
  // subdirectory of where it stood (`…/kb` → `…/kb/hub`). The paths then share a prefix,
  // and in the second case the old path matches *inside* every reference that is already
  // correct — prepending the move a second time. Claiming those matches for an identity
  // rewrite is what makes the overlap safe, and makes any re-run a no-op.
  for (const form of news) if (form && !out.has(form)) out.set(form, form);
  // Longest first, so a `\\`-escaped form is consumed whole rather than partly matched by
  // a shorter spelling of the same path — and so the identity above wins wherever it and
  // an old path could both match, alternation being ordered.
  return [...out].map(([find, replace]) => ({ find, replace })).sort((a, b) => b.find.length - a.find.length);
}

/**
 * Replace every reference to any of `froms` with `to` in the text files under `root`.
 * `dryRun` reports what would change without touching anything.
 */
export function rewritePaths(
  root: string,
  froms: string[],
  to: string,
  opts: { dryRun?: boolean; onStart?: (files: number) => void } = {},
): RewriteResult {
  const table = pairs(froms, to);
  const ci = process.platform === "win32";
  const key = (s: string) => (ci ? s.toLowerCase() : s);
  const lookup = new Map(table.map((p) => [key(p.find), p.replace]));
  // Only where the match ends at a path boundary: without the lookahead, moving `…/old`
  // would also rewrite `…/older`, a sibling whose name merely starts the same way.
  const re = new RegExp(
    `(?:${table.map((p) => escapeRe(p.find)).join("|")})(?=[\\\\/"'\\s,;:)\\]}]|$)`,
    ci ? "gi" : "g",
  );
  const hits: Hit[] = [];
  const failed: { file: string; reason: string }[] = [];
  let scanned = 0;

  // Enumerate before reading, so the counter can say "of how many". The walk is directory
  // entries only — cheap next to opening every file, and worth it for a hub whose raw/ has
  // grown to thousands of documents and would otherwise sit silent.
  const files = [...walk(root)];
  opts.onStart?.(files.length);
  const progress = ticker("checking", files.length);

  for (const file of files) {
    progress.tick(hits.length ? `${hits.length} file(s) with references` : "");
    const text = readText(file);
    if (text === undefined) continue;
    scanned++;
    let count = 0;
    const next = text.replace(re, (m) => {
      const to = lookup.get(key(m));
      if (to === undefined) return m; // not one of ours; leave the text exactly as found
      if (key(to) === key(m)) return m; // already the new path — matched only to shield it
      count++;
      return to;
    });
    if (!count) continue;
    hits.push({ file: relative(root, file) || file, count });
    if (opts.dryRun) continue;
    try {
      writeFileSync(file, next);
    } catch (e) {
      failed.push({ file: relative(root, file) || file, reason: (e as Error).message });
    }
  }
  progress.done();
  return { scanned, hits, failed };
}

/**
 * True when the two spellings name one directory — the only case `khb update --path`
 * refuses, since there is then no move to repair. Overlapping-but-different paths used to
 * be refused alongside it; `pairs()` now shields the new path from being matched inside
 * itself, which is what made the overlap safe to rewrite.
 */
export function sameLocation(from: string, to: string): boolean {
  const norm = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p).replace(/[\\/]+$/, "");
  return norm(from) === norm(to);
}
