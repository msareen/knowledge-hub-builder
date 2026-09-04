// The machine-level registry: ~/.khb/hubs-config.json.
//
// A hub is self-contained and knows nothing about the machine it sits on — that is the
// point of the marker file. But a person with hubs in three places has no way to find
// them from a cold terminal, so khb keeps one small file per *machine* listing where the
// hubs are and which agent to open them with. It holds no knowledge, only paths: delete
// it and nothing is lost but the shortcuts.
//
// Package-side, like paths.ts — importing this must never require a hub to exist.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, basename } from "node:path";
import { markerIn } from "./paths";

/** $KHB_HOME overrides the location — tests and portable installs need it moveable. */
export const KHB_HOME = process.env.KHB_HOME ? resolve(process.env.KHB_HOME) : join(homedir(), ".khb");
export const CONFIG = join(KHB_HOME, "hubs-config.json");

/**
 * How to start an agent in a hub folder. `args` is appended after the hub is cd'd into.
 * `respondArgs`, when set, is how to re-invoke the same agent non-interactively to continue
 * the session just closed and write out an answer — see `khb go --respond` in hubs.ts. The
 * instruction prompt itself is piped to the process over stdin, not appended as an argv
 * element: a long free-text argument survives `spawnSync`'s Windows `shell: true` path
 * unreliably (cmd.exe re-tokenizes on whitespace and mangles embedded quotes), where stdin
 * has no such limit and matches the documented non-interactive usage of both shipped agents.
 *
 * The respond call never asks the agent to write a file at all — it asks for the write-up as
 * the answer, and khb captures stdout and writes it out itself. Two earlier designs did ask
 * for a file: one wrote straight to the destination with a `--add-dir`-style flag for
 * cross-directory access, the other wrote inside the hub for khb to copy out. Both hit the
 * same wall — separate from the CLI's directory sandboxing, agents gate each write behind a
 * one-time approval that a non-interactive `-p`/`exec` run has no way to give, and that gate
 * fires on any path the session hasn't already touched, inside the hub or out. Print mode's
 * whole contract is printing the answer to stdout with no filesystem tool in play, so there
 * is nothing left to gate.
 */
export type AgentSpec = { command: string; args?: string[]; respondArgs?: string[] };

export type HubEntry = {
  name: string;
  description: string;
  path: string;
  added: string;
  lastUsed?: string;
  /**
   * The `created` stamp from the hub's own marker. Copied here purely as an identity
   * fingerprint: after a hub is moved, its registry entry points at nothing, and matching
   * this against the marker at the new location is how `khb update --path` knows which dead entry
   * is the same hub rather than a different one that also went missing.
   */
  created?: string;
};

export type Config = {
  version: 1;
  /** Key into `agents`. Empty string means "never launch anything, just show the path". */
  defaultAgent: string;
  agents: Record<string, AgentSpec>;
  hubs: HubEntry[];
};

/**
 * Shipped defaults. Both are the plain binary name — resolved on PATH at launch time, so
 * a machine without one installed simply fails at spawn with its own error rather than
 * khb pretending to know where it lives.
 */
const DEFAULT_AGENTS: Record<string, AgentSpec> = {
  claude: { command: "claude", args: [], respondArgs: ["-p", "--continue"] },
  codex: { command: "codex", args: [], respondArgs: ["exec", "resume", "--last"] },
};

/** Fields backfilled onto a saved agent entry when the entry predates them — see below. */
const BACKFILL_FIELDS = ["respondArgs"] as const;

/**
 * `{ ...DEFAULT_AGENTS, ...raw }` merges whole agent entries, so a `claude`/`codex` entry
 * saved before a shipped field existed (e.g. `respondArgs`, added for `khb go --respond`)
 * would silently lose that field forever — the saved entry has no such key, but it still
 * fully overwrites the default that does. Backfill field-by-field for the two known keys
 * instead; a saved `command`/`args` customization is left exactly as the user set it. `""`
 * is a deliberate override to disable a flag, so only `undefined` backfills.
 */
function mergeAgents(raw: Record<string, AgentSpec> | undefined): Record<string, AgentSpec> {
  const merged: Record<string, AgentSpec> = { ...DEFAULT_AGENTS, ...(raw ?? {}) };
  for (const key of Object.keys(DEFAULT_AGENTS)) {
    if (!raw?.[key]) continue;
    const patch: Partial<AgentSpec> = {};
    for (const field of BACKFILL_FIELDS)
      if (raw[key][field] === undefined && DEFAULT_AGENTS[key][field] !== undefined)
        (patch as Record<string, unknown>)[field] = DEFAULT_AGENTS[key][field];
    if (Object.keys(patch).length) merged[key] = { ...raw[key], ...patch };
  }
  return merged;
}

const blank = (): Config => ({
  version: 1,
  defaultAgent: "claude",
  agents: { ...DEFAULT_AGENTS },
  hubs: [],
});

/**
 * Read the registry, creating it on first run. Never throws on a damaged file: a
 * corrupted shortcut list must not block `khb lint` in a hub that is perfectly fine, so
 * unreadable JSON is reported once and treated as empty.
 */
export function loadConfig(): Config {
  if (!existsSync(CONFIG)) {
    const fresh = blank();
    saveConfig(fresh);
    return fresh;
  }
  try {
    const raw = JSON.parse(readFileSync(CONFIG, "utf8")) as Partial<Config>;
    return {
      version: 1,
      defaultAgent: raw.defaultAgent ?? "claude",
      agents: mergeAgents(raw.agents),
      hubs: Array.isArray(raw.hubs) ? raw.hubs.filter((h) => h && typeof h.path === "string") : [],
    };
  } catch {
    console.error(`khb: could not read ${CONFIG} — ignoring it. Fix or delete the file.`);
    return blank();
  }
}

export function saveConfig(cfg: Config): void {
  mkdirSync(KHB_HOME, { recursive: true });
  writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + "\n");
}

/**
 * The one true spelling of a path. `resolve` is not enough on Windows, where the same
 * folder is reachable as `C:\Users\MANASV~1\…` and `C:\Users\Manasvi Sareen\…` with
 * different casing again on top — three strings, one directory. Registering it under two
 * of them would list one hub twice and defeat the move repair, so every path stored in or
 * compared against the registry goes through here first.
 *
 * realpath also follows symlinks, which is the behaviour we want: a hub reached through a
 * link is the same hub as the hub itself.
 */
export function canonical(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync.native(abs);
  } catch {
    return abs; // path does not exist (a moved-away hub): the resolved form is the best we have
  }
}

/** Case-insensitive on Windows, after canonicalizing — see `canonical`. */
export const samePath = (a: string, b: string) => {
  const [x, y] = [canonical(a), canonical(b)];
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
};

/** Whatever the hub's own marker says about itself. Unreadable marker → nothing known. */
export function markerFields(hub: string): { name?: string; description?: string; created?: string } {
  const marker = markerIn(hub);
  if (!marker) return {};
  try {
    const j = JSON.parse(readFileSync(join(hub, marker), "utf8"));
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    return { name: str(j.name), description: str(j.description), created: str(j.created) };
  } catch {
    return {}; // a hub with an unreadable marker still deserves a listing
  }
}

/**
 * A one-line description for a hub. Authored in the hub's own `khb.json` (`description`),
 * so it travels with the hub and is not a second place to maintain the same sentence;
 * with none, describe the hub by what is in it. Deliberately does not scrape
 * `outer.index.md` — its opening line is template boilerplate identical in every hub.
 */
export function describeHub(hub: string): string {
  const own = markerFields(hub).description;
  if (own) return own;
  const names = bundleNames(hub);
  if (!names.length) return "no bundles yet";
  const shown = names.slice(0, 4).join(", ");
  return `${names.length} bundle${names.length === 1 ? "" : "s"}: ${shown}${names.length > 4 ? ", …" : ""}`;
}

export function bundleNames(hub: string): string[] {
  try {
    return readdirSync(join(hub, "bundles"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Unique registry name for a hub: what its marker calls itself, else the folder name,
 * suffixed if two hubs on this machine want the same one.
 */
function uniqueName(cfg: Config, hub: string): string {
  const base = markerFields(hub).name ?? basename(hub) ?? "hub";
  if (!cfg.hubs.some((h) => h.name === base)) return base;
  for (let i = 2; ; i++) if (!cfg.hubs.some((h) => h.name === `${base}-${i}`)) return `${base}-${i}`;
}

/**
 * Record a hub in the registry, or refresh what is already recorded. Called whenever khb
 * resolves a hub, so hubs created before the registry existed register themselves the
 * first time any command runs in them — no migration step, no `khb register` to remember.
 * A user-edited name is never overwritten; the description is, since it is derived.
 */
export function registerHub(hub: string, opts: { name?: string; description?: string } = {}): HubEntry {
  const path = canonical(hub);
  const cfg = loadConfig();
  const own = markerFields(path);
  let entry = cfg.hubs.find((h) => samePath(resolve(h.path), path));
  if (entry) {
    entry.path = path;
    // Both fields are derived from the hub, so both re-derive: rename or re-describe a hub
    // in its own khb.json and the listing follows on the next command run there.
    if (opts.name ?? own.name) entry.name = opts.name ?? own.name!;
    entry.description = opts.description ?? describeHub(path);
    entry.created = own.created;
  } else {
    entry = {
      name: opts.name ?? uniqueName(cfg, path),
      description: opts.description ?? describeHub(path),
      path,
      added: new Date().toISOString(),
      created: own.created,
    };
    cfg.hubs.push(entry);
  }
  saveConfig(cfg);
  return entry;
}

/** Stamp a hub as most recently used, so the picker can order by recency. */
export function touchHub(hub: string): void {
  const path = canonical(hub);
  const cfg = loadConfig();
  const entry = cfg.hubs.find((h) => samePath(resolve(h.path), path));
  if (!entry) return;
  entry.lastUsed = new Date().toISOString();
  saveConfig(cfg);
}

export function forgetHub(nameOrPath: string): HubEntry | undefined {
  const cfg = loadConfig();
  const i = cfg.hubs.findIndex(
    (h) => h.name === nameOrPath || samePath(resolve(h.path), resolve(nameOrPath)),
  );
  if (i < 0) return undefined;
  const [gone] = cfg.hubs.splice(i, 1);
  saveConfig(cfg);
  return gone;
}

/** A registered hub whose folder no longer holds a marker — moved, deleted, or unmounted. */
export const isAlive = (h: HubEntry): boolean => existsSync(h.path) && !!markerIn(h.path);

/**
 * Dead entries that are plausibly `hub` under its former name, best evidence first:
 * an identical `created` stamp is proof (it is minted once, at `khb init`), a matching
 * registry name is a guess. Returning candidates rather than picking one is deliberate —
 * `khb update --path` acts on proof and asks when it only has a guess.
 */
export function relocationCandidates(hub: string): { certain: HubEntry[]; likely: HubEntry[] } {
  const path = canonical(hub);
  const own = markerFields(path);
  const dead = loadConfig().hubs.filter((h) => !isAlive(h) && !samePath(resolve(h.path), path));
  const certain = own.created ? dead.filter((h) => h.created === own.created) : [];
  const likely = dead.filter(
    (h) => !certain.includes(h) && h.name === (own.name ?? basename(path)),
  );
  return { certain, likely };
}

/**
 * Point a registry entry at where the hub now lives. If the new location was already
 * registered separately — a `khb` command was run there before anyone repaired the move —
 * the two entries are the same hub, so fold the older one's history into the survivor
 * rather than leaving a duplicate behind.
 */
export function relocateHub(oldPath: string, newPath: string): HubEntry {
  const from = canonical(oldPath);
  const to = canonical(newPath);
  const cfg = loadConfig();
  const stale = cfg.hubs.find((h) => samePath(resolve(h.path), from));
  const already = cfg.hubs.find((h) => samePath(resolve(h.path), to));

  const survivor = stale ?? already ?? {
    name: uniqueName(cfg, to),
    description: describeHub(to),
    path: to,
    added: new Date().toISOString(),
  };
  if (stale && already && stale !== already) {
    survivor.added = [stale.added, already.added].filter(Boolean).sort()[0];
    survivor.lastUsed = [stale.lastUsed, already.lastUsed].filter(Boolean).sort().pop();
    cfg.hubs.splice(cfg.hubs.indexOf(already), 1);
  }
  if (!cfg.hubs.includes(survivor)) cfg.hubs.push(survivor);

  survivor.path = to;
  const own = markerFields(to);
  // A name the marker states is the hub's own and survives the move. A name that was only
  // ever the old folder's would otherwise outlive the folder — re-derive it from the new
  // location, so the listing does not go on calling a hub after a directory that is gone.
  if (own.name) survivor.name = own.name;
  else if (survivor.name === basename(from)) {
    const taken = cfg.hubs.filter((h) => h !== survivor);
    survivor.name = uniqueName({ ...cfg, hubs: taken }, to);
  }
  survivor.description = describeHub(to);
  survivor.created = own.created;
  saveConfig(cfg);
  return survivor;
}

/** Registered hubs, live ones first, each group most-recently-used first. */
export function listHubs(): HubEntry[] {
  const recency = (h: HubEntry) => Date.parse(h.lastUsed ?? h.added) || 0;
  return loadConfig().hubs.slice().sort((a, b) => {
    if (isAlive(a) !== isAlive(b)) return isAlive(a) ? -1 : 1;
    return recency(b) - recency(a);
  });
}

/** Resolve `khb go <what>` — a registry name, a 1-based list position, or a path. */
export function findHubEntry(what: string): HubEntry | undefined {
  const hubs = listHubs();
  const byName = hubs.find((h) => h.name === what);
  if (byName) return byName;
  const n = Number(what);
  if (Number.isInteger(n) && n >= 1 && n <= hubs.length) return hubs[n - 1];
  return hubs.find((h) => samePath(resolve(h.path), resolve(what)));
}

/**
 * Is this command actually runnable? Probed with `--version`, which no agent acts on.
 * Used by the first-run wizard to offer what is installed, and by the config check to say
 * so before `khb go` fails at spawn.
 */
export function onPath(command: string): boolean {
  try {
    const probe = spawnSync(command, ["--version"], {
      stdio: "ignore",
      shell: process.platform === "win32",
      timeout: 5000,
    });
    return !probe.error && probe.status === 0;
  } catch {
    return false;
  }
}

export function agentFor(cfg: Config, name?: string): { name: string; spec: AgentSpec } | undefined {
  const key = name ?? cfg.defaultAgent;
  if (!key) return undefined;
  const spec = cfg.agents[key];
  // An unknown name is still usable as a bare command — someone naming an agent khb has
  // never heard of should get their agent, not a lecture about the config file.
  return { name: key, spec: spec ?? { command: key, args: [] } };
}
