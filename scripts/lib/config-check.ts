// Schema check for the machine-level config, ~/.khb/hubs-config.json.
//
// The registry is the one khb file a person is invited to open in an editor — it holds
// their agent command and their hub list — and `loadConfig()` is deliberately forgiving:
// it fills in defaults, ignores keys it does not know, and treats an unparseable file as
// an empty one so a damaged registry never blocks `khb lint` in a hub that is perfectly
// fine. That forgiveness is right at load time and wrong as the only feedback anyone ever
// gets: a typo'd `defaultagent` is silently ignored, a hand-pasted duplicate makes `khb
// forget` look broken, and a hub renamed in its own khb.json goes on being listed under
// the old name until something happens to run in it.
//
// So the tolerance stays, and the diagnosis lives here: one checker, two readers. `khb
// doctor` reports what it finds and names the command that repairs it — doctor writes
// nothing, ever — and `khb config fix` is that command. Neither has its own copy of the
// rules.
//
// A finding carries a `repair` only when the fix is mechanical and loses nothing. Anything
// that needs a human decision (which of two same-named hubs should be renamed, whether a
// missing folder is deleted or on an unplugged drive) is reported with the command to run
// and left alone.
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { MARKER, markerIn } from "./paths";
import {
  CONFIG,
  canonical,
  describeHub,
  isAlive,
  loadConfig,
  markerFields,
  onPath,
  samePath,
  type AgentSpec,
  type Config,
  type HubEntry,
} from "./registry";

export type Finding = {
  /** error: something is being silently dropped or is unusable. warn: it still works. */
  level: "error" | "warn";
  /** What is wrong, in one line. */
  what: string;
  /** The command that puts it right. */
  fix: string;
  /**
   * Present only when `khb config fix` can repair it unattended. Mutates the *normalized*
   * config, which is then written back.
   */
  repair?: (cfg: Config) => void;
};

export type ConfigReport = {
  path: string;
  exists: boolean;
  /** False when the file is there but unparseable — everything in it is being ignored. */
  readable: boolean;
  findings: Finding[];
};

/** Top-level keys the schema defines. Anything else is dropped by `loadConfig`. */
const KNOWN_KEYS = ["version", "defaultAgent", "agents", "hubs"];
/** Keys a hub entry may carry. Unlike the top level, unknown ones here survive a rewrite. */
const KNOWN_HUB_KEYS = ["name", "description", "path", "added", "lastUsed", "created"];

const isTimestamp = (value: unknown) => typeof value === "string" && !Number.isNaN(Date.parse(value));

/**
 * Everything wrong with the machine config, worst first.
 *
 * `probeAgent` runs the default agent's command to see whether it exists. It is the only
 * check that costs anything, and the only one a caller may want to skip.
 */
export function checkConfig({ probeAgent = true } = {}): ConfigReport {
  const findings: Finding[] = [];
  const add = (finding: Finding) => findings.push(finding);

  if (!existsSync(CONFIG))
    // Not a fault: the file is written on first use. Nothing to check.
    return { path: CONFIG, exists: false, readable: true, findings };

  let raw: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(CONFIG, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    raw = parsed as Record<string, unknown>;
  } catch (e) {
    add({
      level: "error",
      what: `not valid JSON (${(e as Error).message}) — khb is ignoring the whole file, so every hub shortcut and your agent setting are gone until it parses`,
      fix: "khb config edit",
    });
    return { path: CONFIG, exists: true, readable: false, findings };
  }

  // The normalized view: what khb actually acts on. Comparing it against `raw` is how the
  // silent drops become visible.
  const cfg = loadConfig();

  // ---- file shape -----------------------------------------------------------------------
  const unknown = Object.keys(raw).filter((key) => !KNOWN_KEYS.includes(key));
  if (unknown.length)
    add({
      level: "warn",
      what: `unknown top-level key(s) ignored on load: ${unknown.join(", ")}${
        unknown.some((key) => KNOWN_KEYS.some((known) => known.toLowerCase() === key.toLowerCase()))
          ? " — one of them differs from a real key only in case"
          : ""
      }`,
      fix: "khb config fix",
      // Nothing to do: these exist only in the file, and the rewrite is what removes them.
      repair: () => {},
    });

  if (raw.version !== undefined && raw.version !== 1)
    add({
      level: "warn",
      what: `version is ${JSON.stringify(raw.version)}, not 1 — this file may have been written by a different khb`,
      fix: "khb config view    (then khb config fix if the contents look right)",
    });

  // ---- agents ---------------------------------------------------------------------------
  for (const [name, spec] of Object.entries(cfg.agents)) {
    const command = (spec as AgentSpec)?.command;
    if (typeof command !== "string" || !command.trim())
      add({
        level: "error",
        what: `agent '${name}' has no command — launching it would spawn nothing`,
        fix: `khb agent ${name} --command <exe>`,
        repair: (config) => {
          config.agents[name] = { command: name, args: (spec as AgentSpec)?.args ?? [] };
        },
      });
    else if ((spec as AgentSpec).args !== undefined && !Array.isArray((spec as AgentSpec).args))
      add({
        level: "error",
        what: `agent '${name}' has a non-list 'args'`,
        fix: `khb agent ${name} --args "…"`,
        repair: (config) => {
          config.agents[name] = { command, args: [] };
        },
      });
  }

  if (cfg.defaultAgent && !cfg.agents[cfg.defaultAgent])
    add({
      level: "warn",
      what: `defaultAgent '${cfg.defaultAgent}' is not in 'agents' — khb go runs it as a bare command, which works but records nothing about it`,
      fix: "khb config fix",
      repair: (config) => {
        config.agents[config.defaultAgent] = { command: config.defaultAgent, args: [] };
      },
    });

  if (probeAgent && cfg.defaultAgent) {
    const command = cfg.agents[cfg.defaultAgent]?.command ?? cfg.defaultAgent;
    if (!onPath(command))
      add({
        level: "warn",
        what: `default agent '${cfg.defaultAgent}' runs '${command}', which is not on PATH — khb go will fail at launch`,
        fix: `khb agent ${cfg.defaultAgent} --command <exe>    (or 'khb agent none' to just print the path)`,
      });
  }

  // ---- hub entries ----------------------------------------------------------------------
  const rawHubs = Array.isArray(raw.hubs) ? (raw.hubs as unknown[]) : [];
  if (raw.hubs !== undefined && !Array.isArray(raw.hubs))
    add({
      level: "error",
      what: `'hubs' is not a list — every shortcut is being ignored`,
      fix: "khb config edit",
    });

  const dropped = rawHubs.length - cfg.hubs.length;
  if (dropped > 0)
    add({
      level: "error",
      what: `${dropped} hub entr${dropped === 1 ? "y has" : "ies have"} no usable 'path' and ${dropped === 1 ? "is" : "are"} ignored on load`,
      fix: "khb config fix",
      // Same as the unknown keys: they survive only in the file, and rewriting drops them.
      repair: () => {},
    });

  for (const entry of cfg.hubs) {
    const label = entry.name || entry.path;
    const extra = Object.keys(entry).filter((key) => !KNOWN_HUB_KEYS.includes(key));
    if (extra.length)
      add({
        level: "warn",
        what: `hub '${label}' carries key(s) the schema does not define: ${extra.join(", ")}`,
        fix: "khb config fix",
        repair: (config) => {
          const target = config.hubs.find((hub) => hub.path === entry.path);
          for (const key of extra) delete (target as unknown as Record<string, unknown>)[key];
        },
      });

    if (!isAbsolute(entry.path))
      add({
        level: "error",
        what: `hub '${label}' has a relative path (${entry.path}) — it resolves against whatever directory khb happens to run in`,
        fix: "khb config fix",
        repair: (config) => {
          const target = config.hubs.find((hub) => hub.path === entry.path);
          if (target) target.path = canonical(target.path);
        },
      });
    // Only for a hub that still exists. A dead entry's path string is evidence: `khb update
    // --path` searches the hub's files for exactly that spelling, so rewriting it to a
    // canonical form khb has never seen would destroy the one clue the repair needs.
    else if (isAlive(entry) && canonical(entry.path) !== entry.path)
      add({
        level: "warn",
        what: `hub '${label}' is listed as ${entry.path}, which is not the spelling khb compares against (${canonical(entry.path)})`,
        fix: "khb config fix",
        repair: (config) => {
          const target = config.hubs.find((hub) => hub.path === entry.path);
          if (target) target.path = canonical(target.path);
        },
      });

    for (const field of ["added", "lastUsed", "created"] as const) {
      const value = entry[field];
      if (value !== undefined && !isTimestamp(value))
        add({
          level: "warn",
          what: `hub '${label}' has an unreadable ${field} (${JSON.stringify(value)})${
            field === "lastUsed" ? " — it sorts to the bottom of khb list" : ""
          }`,
          fix: "khb config fix",
          repair: (config) => {
            const target = config.hubs.find((hub) => hub.path === entry.path);
            if (!target) return;
            if (field === "added") target.added = target.lastUsed ?? new Date().toISOString();
            else delete target[field];
          },
        });
    }
    if (entry.added === undefined)
      add({
        level: "warn",
        what: `hub '${label}' has no 'added' timestamp`,
        fix: "khb config fix",
        repair: (config) => {
          const target = config.hubs.find((hub) => hub.path === entry.path);
          if (target) target.added = target.lastUsed ?? new Date().toISOString();
        },
      });

    if (!isAlive(entry)) {
      const gone = !existsSync(entry.path);
      add({
        level: "warn",
        what: `hub '${label}' is registered at ${entry.path}, which ${gone ? "does not exist" : "is no longer a hub (no khb.json)"} — khb list shows it as MISSING`,
        // Deliberately not auto-repaired: a path that is gone today can be an unplugged
        // drive or an unmounted share tomorrow, and a moved hub wants repointing, not
        // forgetting. Both need the person to say which it is.
        fix: `khb forget ${entry.name}    (or 'khb update --path' from its new location, if it moved)`,
      });
      continue; // the checks below all read the hub's own marker, and there is none
    }

    // Name and description are derived from the hub's own khb.json and refreshed whenever a
    // command runs in that hub — so a hub renamed in its marker keeps its old listing here
    // until something happens to run there. Nothing is broken; the list is just stale.
    const own = markerFields(entry.path);
    if (own.name && own.name !== entry.name)
      add({
        level: "warn",
        what: `hub '${entry.name}' calls itself '${own.name}' in its own khb.json — the list is stale`,
        fix: "khb config fix",
        repair: (config) => {
          const target = config.hubs.find((hub) => hub.path === entry.path);
          if (target) target.name = own.name!;
        },
      });
    const described = describeHub(entry.path);
    if (described !== entry.description)
      add({
        level: "warn",
        what: `hub '${label}' is described as "${entry.description}", but its hub now reads "${described}"`,
        fix: "khb config fix",
        repair: (config) => {
          const target = config.hubs.find((hub) => hub.path === entry.path);
          if (target) target.description = described;
        },
      });
    if (own.created && entry.created !== own.created)
      add({
        level: "warn",
        what: `hub '${label}' has a 'created' stamp that does not match its marker — khb update --path uses it to recognise a moved hub`,
        fix: "khb config fix",
        repair: (config) => {
          const target = config.hubs.find((hub) => hub.path === entry.path);
          if (target) target.created = own.created;
        },
      });
  }

  // ---- collisions between entries --------------------------------------------------------
  for (let i = 0; i < cfg.hubs.length; i++) {
    for (let j = i + 1; j < cfg.hubs.length; j++) {
      const [first, second] = [cfg.hubs[i], cfg.hubs[j]];
      if (samePath(resolve(first.path), resolve(second.path)))
        add({
          level: "error",
          what: `${first.path} is listed twice (as '${first.name}' and '${second.name}') — khb list shows it twice and khb forget removes only one of them`,
          fix: "khb config fix",
          repair: (config) => mergeDuplicate(config, first, second),
        });
      else if (first.name === second.name)
        add({
          level: "error",
          what: `two hubs are both named '${first.name}' — 'khb go ${first.name}' can only ever reach the first, and the second is unreachable by name`,
          // Not auto-repairable, and the reason matters: a name is re-derived from each
          // hub's own khb.json on every command run there, so renaming the entry here
          // would be undone by the next command in that hub. The rename has to happen in
          // the marker, which is the hub owner's call.
          fix: `edit the 'name' in ${join(second.path, markerIn(second.path) ?? MARKER)}    (a registry rename is overwritten on the next command run there)`,
        });
    }
  }

  // A hub whose name is a number shadows the list-position selector: findHubEntry matches
  // names before positions, so `khb go 2` opens the hub *called* "2" and the hub at
  // position 2 becomes unreachable by number.
  for (const entry of cfg.hubs) {
    const asNumber = Number(entry.name);
    if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= cfg.hubs.length)
      add({
        level: "warn",
        what: `hub named '${entry.name}' shadows the list position of the same number — 'khb go ${entry.name}' opens this hub, never the ${entry.name}${ordinal(asNumber)} in khb list`,
        fix: `edit the 'name' in ${join(entry.path, markerIn(entry.path) ?? MARKER)}`,
      });
  }

  const order = { error: 0, warn: 1 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  return { path: CONFIG, exists: true, readable: true, findings };
}

const ordinal = (n: number) => (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th");

/**
 * Fold one duplicate entry into the other, keeping the longer history: the earliest
 * `added` and the most recent `lastUsed`, the same way `relocateHub` merges the pair a
 * repaired move can leave behind.
 */
function mergeDuplicate(config: Config, first: HubEntry, second: HubEntry): void {
  const keep = config.hubs.find((hub) => hub.path === first.path);
  const dropAt = config.hubs.findIndex((hub) => hub !== keep && hub.path === second.path);
  if (!keep || dropAt < 0) return;
  const drop = config.hubs[dropAt];
  keep.added = [keep.added, drop.added].filter(Boolean).sort()[0] ?? keep.added;
  keep.lastUsed = [keep.lastUsed, drop.lastUsed].filter(Boolean).sort().pop();
  keep.created = keep.created ?? drop.created;
  config.hubs.splice(dropAt, 1);
}

/** Drop every entry whose folder is no longer a hub. Only `khb config fix --prune` does this. */
export function pruneDead(config: Config): HubEntry[] {
  const dead = config.hubs.filter((hub) => !existsSync(hub.path) || !markerIn(hub.path));
  config.hubs = config.hubs.filter((hub) => !dead.includes(hub));
  return dead;
}
