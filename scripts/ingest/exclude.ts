// One rule for `exclude:` entries in sources.yaml, shared by folder and files sources. An
// entry that starts with a drive letter or `/` is absolute and is checked against the file's
// absolute path; anything else is relative and checked against the file's path relative to
// its source root (or, for `files` sources, its basename). Within either case, an entry with
// no glob metacharacter (* ? [) is a plain prefix — it matches the path itself or anything
// under it — and an entry with one is a Bun.Glob pattern. Bun.Glob is a global, no import
// needed.
import { isAbsolute } from "node:path";

const isGlobPattern = (p: string) => /[*?[]/.test(p);
const posix = (p: string) => p.replaceAll("\\", "/");

type Matcher = (path: string) => boolean;

function makeMatcher(patterns: string[]): Matcher {
  const plain: string[] = [];
  const globs: Bun.Glob[] = [];
  for (const raw of patterns) {
    const p = posix(raw).replace(/\/+$/, ""); // trailing slash is cosmetic on a plain entry
    if (isGlobPattern(p)) globs.push(new Bun.Glob(p));
    else plain.push(p);
  }
  return (path: string) =>
    plain.some((p) => path === p || path.startsWith(`${p}/`)) || globs.some((g) => g.match(path));
}

/**
 * Build an excluder from `sources.yaml`'s `exclude:` list. The returned function takes a
 * file's absolute path and its path relative to the source (or basename, for `files`
 * sources) and reports whether either matched an exclude entry of the corresponding kind.
 */
export function makeExcluder(patterns: string[] | undefined): (absPath: string, relPath: string) => boolean {
  if (!patterns?.length) return () => false;
  const abs = makeMatcher(patterns.filter((p) => isAbsolute(p)).map(posix));
  const rel = makeMatcher(patterns.filter((p) => !isAbsolute(p)));
  return (absPath: string, relPath: string) => abs(posix(absPath)) || rel(relPath);
}
