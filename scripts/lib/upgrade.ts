// The upgrade mechanism: refresh a hub's package-owned contract docs to match the
// installed khb. Lives here rather than in init.ts because two callers need it — the
// explicit `khb upgrade`, and the drift check cli.ts runs before every hub command.
//
// Nothing here may import util.ts: the drift check runs before a hub is resolved, and
// util.ts resolves one or exits.
import { cpSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { PKG, MANAGED, RETIRED, MARKER, markerIn, version } from "./paths";

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

/** Write khb.json with the installed version, preserving the hub's creation date. */
export function stamp(hub: string, created?: string) {
  writeFileSync(
    join(hub, MARKER),
    JSON.stringify(
      { khb: version(), created: created ?? new Date().toISOString(), upgraded: new Date().toISOString() },
      null,
      2,
    ) + "\n",
  );
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
  try {
    const before = JSON.parse(readFileSync(join(hub, found), "utf8"));
    created = before.created;
    from = before.khb ?? before.bkr;
  } catch {
    /* unreadable marker: rewritten below with today's date */
  }
  if (found !== MARKER) rmSync(join(hub, found));
  const synced = syncManaged(hub);
  const pruned = pruneRetired(hub);
  stamp(hub, created);
  return { from, to: version(), synced, pruned, renamed: found === MARKER ? undefined : found };
}
