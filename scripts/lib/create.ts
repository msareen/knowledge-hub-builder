// Creating a hub, as a function rather than a script.
//
// Two callers need it and must not diverge: `khb init`, and the first-run wizard a bare
// `khb` opens when the machine has no hubs yet. A hub made by the wizard is the same hub
// down to the byte — the wizard only asks the questions `init` takes as flags.
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { HUB_TEMPLATE } from "./paths";
import { syncManaged, stamp } from "./upgrade";
import { registerHub, type HubEntry } from "./registry";

export type CreatedHub = {
  hub: string;
  /** Package-owned contract files copied in, for the caller to report. */
  synced: string[];
  entry: HubEntry;
};

export function createHub(
  dir: string,
  opts: { name?: string; description?: string } = {},
): CreatedHub {
  const hub = resolve(dir);
  mkdirSync(join(hub, "bundles"), { recursive: true });
  cpSync(join(HUB_TEMPLATE, "outer.index.md"), join(hub, "outer.index.md"));
  // Dotfiles: shipped unprefixed so npm doesn't swallow them, renamed on the way in.
  // Never clobber — a hub may be created inside a folder that is already a git repo.
  for (const f of ["gitignore", "gitattributes"])
    if (!existsSync(join(hub, `.${f}`))) cpSync(join(HUB_TEMPLATE, f), join(hub, `.${f}`));
  const synced = syncManaged(hub);
  stamp(hub, undefined, {
    ...(opts.name ? { name: opts.name } : {}),
    ...(opts.description ? { description: opts.description } : {}),
  });
  // Put it on the machine's shortcut list straight away, so a bare `khb` from any
  // terminal can find its way back here without the user remembering the path.
  const entry = registerHub(hub);
  return { hub, synced, entry };
}
