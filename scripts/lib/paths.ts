// Package-side paths. Importing this must never require a hub to exist — `khb init`
// runs before there is one. Hub-side paths live in util.ts.
import { fileURLToPath } from "node:url";
import { join, dirname, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";

/** Root of the installed @msareen/knowledge-hub-builder package (NOT the user's hub). */
export const PKG = fileURLToPath(new URL("../..", import.meta.url));

export const TEMPLATE = join(PKG, ".bundle_template");
export const HUB_TEMPLATE = join(PKG, "templates", "hub");

/** Marker file that identifies a hub root; `khb` walks up from cwd looking for it. */
export const MARKER = "khb.json";

/**
 * Marker names used by earlier versions. Still recognised when resolving a hub —
 * otherwise a hub created before the rename becomes invisible to every command,
 * `khb upgrade` included, and there is no way in from the CLI. `khb upgrade` renames
 * the file it finds to MARKER, so each hub carries a legacy name at most once.
 */
export const LEGACY_MARKERS = ["bkr.json"];

/**
 * The marker file present in `dir`, if it is a hub at all. Lives here rather than in
 * util.ts because `khb init` needs it *before* a hub exists, and importing util.ts
 * resolves a hub or exits.
 */
export const markerIn = (dir: string): string | undefined =>
  [MARKER, ...LEGACY_MARKERS].find((m) => existsSync(join(dir, m)));

/**
 * The hub this invocation acts on, or undefined if there is none. Precedence:
 * $KHB_HUB (set from --hub by cli.ts) > nearest ancestor of cwd holding a marker.
 * Soft by design — util.ts turns "none" into an error with guidance, while the version
 * drift check in cli.ts must stay silent for commands that run outside a hub.
 */
export function findHub(): string | undefined {
  const explicit = process.env.KHB_HUB;
  if (explicit) {
    const dir = resolve(explicit);
    return markerIn(dir) ? dir : undefined;
  }
  for (let dir = process.cwd(); ; ) {
    if (markerIn(dir)) return dir;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

/**
 * Package-owned files copied into every hub by `khb init` and refreshed by
 * `khb upgrade`. These are the agent contract — the hub needs its own copies so an
 * agent opened on the hub folder can read them without knowing where khb is installed.
 * Anything here is overwritten on upgrade, so users must not edit them.
 */
export const MANAGED = [
  "AGENTS.md",
  "CLAUDE.md",
  "SPEC.md",
  "skills",
  ".agents/skills",
  ".claude/skills",
];

/**
 * Files that used to be MANAGED and no longer are. `khb upgrade` deletes them from the
 * hub — a stale copy left behind states an older contract than the one now shipping,
 * and an agent has no way to tell which is current. Only ever list package-owned names.
 */
export const RETIRED = ["AGENT.md", "query.md", "ingest.md", "lint.md"];

export const version = (): string =>
  JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")).version ?? "0.0.0";
