// The upgrade mechanism: refresh a hub's package-owned contract docs to match the
// installed khb. Lives here rather than in init.ts because two callers need it — the
// explicit `khb upgrade`, and the drift check cli.ts runs before every hub command.
//
// Nothing here may import util.ts: the drift check runs before a hub is resolved, and
// util.ts resolves one or exits.
import { cpSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { PKG, MANAGED, RETIRED, MARKER, markerIn, version } from "./paths";
import { canonical } from "./registry";

export type UpgradeResult = {
  /** Version recorded in the hub's marker before the upgrade, if it recorded one. */
  from?: string;
  to: string;
  synced: string[];
  pruned: string[];
  /** Set when a legacy marker name was renamed to khb.json. */
  renamed?: string;
};

/** Read the khb version a hub was last stamped with. Undefined if it records none. */
export function hubVersion(hub: string): string | undefined {
  const found = markerIn(hub);
  if (!found) return undefined;
  try {
    const marker = JSON.parse(readFileSync(join(hub, found), "utf8"));
    return marker.khb ?? marker.bkr; // bkr: the pre-rename field name
  } catch {
    return undefined; // unreadable marker — treat as drifted, upgrade will restamp it
  }
}

/** Copy every package-owned contract file into the hub, replacing what is there. */
export function syncManaged(hub: string): string[] {
  const done: string[] = [];
  for (const f of MANAGED) {
    const src = join(PKG, f);
    if (!existsSync(src)) continue;
    const dest = join(hub, f);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true, force: true });
    done.push(statSync(src).isDirectory() ? `${f}/` : f);
  }
  return done;
}

/** Drop package-owned files that later versions stopped shipping. */
function pruneRetired(hub: string): string[] {
  const gone: string[] = [];
  for (const f of RETIRED) {
    const p = join(hub, f);
    if (!existsSync(p)) continue;
    rmSync(p, { recursive: true, force: true });
    gone.push(f);
  }
  return gone;
}

/** Whatever is in the hub's marker, or an empty object if it has none or it is broken. */
export function readMarker(hub: string): Record<string, unknown> {
  try {
    const found = markerIn(hub);
    if (!found) return {};
    const j = JSON.parse(readFileSync(join(hub, found), "utf8"));
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

/** `movedFrom` reads as one path or several — normalise both to a list. */
const asList = (v: unknown): string[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

/**
 * Where the hub is, in the two spellings that matter. `path` is canonical, so it is
 * comparable; `pathAs` is the spelling khb was actually invoked through, kept only when it
 * differs — `C:\Users\MANASV~1\…` for `C:\Users\Manasvi Sareen\…`, or a symlink standing in
 * for its target. That second one is not decoration: files written during a run hold the
 * spelling of *that* run, so a hub only ever reached by its short name has a `raw/` full of
 * short-name sources, and a repair that knew only the canonical form would miss every one.
 */
function location(hub: string): { path: string; pathAs?: string } {
  const path = canonical(hub);
  const pathAs = resolve(hub);
  return pathAs === path ? { path } : { path, pathAs };
}

/**
 * Write khb.json with the installed version. khb owns six keys — `khb`, `created`,
 * `upgraded`, `path`, `pathAs`, `movedFrom` — and everything else in the marker belongs to
 * whoever put it there: the hub's `name` and `description`, or a note the user added. Merge
 * rather than replace, or an upgrade would silently eat what it does not recognise.
 */
export function stamp(hub: string, created?: string, extra: Record<string, unknown> = {}) {
  const path = join(hub, MARKER);
  const existing = readMarker(hub);
  const merged: Record<string, unknown> = {
    ...existing,
    ...extra,
    khb: version(),
    created: created ?? (existing.created as string) ?? new Date().toISOString(),
    upgraded: new Date().toISOString(),
    ...location(hub),
  };
  if (!location(hub).pathAs) delete merged.pathAs;
  delete merged.bkr; // pre-rename version field; `khb` replaces it
  writeFileSync(path, JSON.stringify(merged, null, 2) + "\n");
}

export type Located = {
  /** Where the marker said the hub was, when that is no longer where it is. */
  moved?: string;
  /** Every stale location recorded and not yet repaired, oldest first. */
  movedFrom: string[];
};

/**
 * Keep the hub's own record of where it lives current, and notice when it changed.
 *
 * The marker is the one thing that travels *with* the folder, so it is the only place a
 * move can be detected without being told: the machine registry knows a hub went missing
 * but not which live hub it became, and after `~/.khb` is deleted or the folder is opened
 * on another machine it knows nothing at all. A `path` key costs one string and turns
 * "khb update-path --from <the path you must now remember>" into a command with no
 * arguments.
 *
 * Stale locations accumulate in `movedFrom` rather than replacing each other: a hub moved
 * twice before anyone repaired it has references to both former homes, and `update-path`
 * rewrites the whole list in one pass. `khb update-path` clears it — see `clearMoved`.
 *
 * Writes only when something actually changed, so the common case leaves khb.json — and
 * anyone's git status — untouched.
 */
export function recordLocation(hub: string): Located {
  const now = location(hub);
  const marker = readMarker(hub);
  const was = typeof marker.path === "string" ? marker.path : undefined;
  const movedFrom = asList(marker.movedFrom);

  if (was === now.path) {
    // Same place. Only one thing can still be missing: the alias this run came in through,
    // when the hub was last located by its canonical name and is now being reached by a
    // short name or a symlink. Filled in once, never replaced — replacing it would rewrite
    // khb.json on every alternation between two equally valid spellings.
    if (now.pathAs && typeof marker.pathAs !== "string") {
      try {
        writeFileSync(
          join(hub, markerIn(hub) ?? MARKER),
          JSON.stringify({ ...marker, ...now }, null, 2) + "\n",
        );
      } catch {
        /* read-only hub */
      }
    }
    return { movedFrom };
  }
  const moved = was;
  // The alias first, the canonical form last: `update-path` reports the final entry as the
  // move, and one directory's two names are better reported under the comparable one.
  for (const p of [marker.pathAs, was])
    if (typeof p === "string" && p && !movedFrom.includes(p)) movedFrom.push(p);

  const next: Record<string, unknown> = { ...marker, ...now };
  if (!now.pathAs) delete next.pathAs;
  if (movedFrom.length) next.movedFrom = movedFrom;
  try {
    // Into the marker as it is *named* here, not MARKER: a hub still carrying a pre-rename
    // filename is about to be renamed by the drift check, and writing the new name first
    // would leave it holding two markers.
    writeFileSync(join(hub, markerIn(hub) ?? MARKER), JSON.stringify(next, null, 2) + "\n");
  } catch {
    /* read-only hub: the location is a convenience, never a precondition for the command */
  }
  return { moved, movedFrom };
}

/**
 * Every location this hub has recorded that is no longer where it stands, oldest first and
 * ending with the most recent one — which is the move to report.
 *
 * Reads `path`/`pathAs` as well as the `movedFrom` backlog, because `khb update-path` runs
 * outside a hub and therefore outside the drift check that calls `recordLocation`: repairing
 * a move directly, with no khb command run in between, must work exactly as well.
 */
export function staleLocations(hub: string): string[] {
  const marker = readMarker(hub);
  const key = (s: string) => (process.platform === "win32" ? s.toLowerCase() : s);
  const mine = new Set([key(canonical(hub)), key(resolve(hub))]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...asList(marker.movedFrom), marker.pathAs, marker.path]) {
    if (typeof p !== "string" || !p) continue;
    // canonical() of a folder that no longer exists is just its resolved form, which is
    // what makes a former home comparable at all.
    if (mine.has(key(canonical(p))) || mine.has(key(p)) || seen.has(key(p))) continue;
    seen.add(key(p));
    out.push(p);
  }
  return out;
}

/** The move is repaired: drop the backlog, keep `path` pointing where the hub now is. */
export function clearMoved(hub: string): void {
  const marker = readMarker(hub);
  const now = location(hub);
  if (!("movedFrom" in marker) && marker.path === now.path && marker.pathAs === now.pathAs) return;
  delete marker.movedFrom;
  Object.assign(marker, now);
  if (!now.pathAs) delete marker.pathAs;
  writeFileSync(join(hub, markerIn(hub) ?? MARKER), JSON.stringify(marker, null, 2) + "\n");
}

/**
 * Bring `hub`'s package-owned files up to the installed version. Touches only what the
 * package owns: bundles/, outer.index.md and anything else the user wrote are untouched.
 */
export function upgradeHub(hub: string): UpgradeResult {
  // The hub may still carry a marker name from an older version; stamp() writes MARKER,
  // so drop the old file rather than leaving the hub with two.
  const found = markerIn(hub)!;
  let created: string | undefined;
  let from: string | undefined;
  // Carried forward by hand rather than left to stamp(): under a legacy name the file is
  // deleted below, so its contents must be read out before it goes.
  let carried: Record<string, unknown> = {};
  try {
    const before = JSON.parse(readFileSync(join(hub, found), "utf8"));
    created = before.created;
    from = before.khb ?? before.bkr;
    carried = before;
  } catch {
    /* unreadable marker: rewritten below with today's date */
  }
  if (found !== MARKER) rmSync(join(hub, found));
  const synced = syncManaged(hub);
  const pruned = pruneRetired(hub);
  stamp(hub, created, carried);
  return { from, to: version(), synced, pruned, renamed: found === MARKER ? undefined : found };
}
