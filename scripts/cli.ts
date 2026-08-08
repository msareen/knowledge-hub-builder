#!/usr/bin/env bun
// khb — the CLI. Subcommands are loaded lazily: `init` must run before a hub exists,
// so nothing that resolves a hub may be imported at module scope.
import { version, findHub, markerIn, MARKER } from "./lib/paths";

const COMMANDS: Record<string, { load: () => Promise<unknown>; usage: string; desc: string }> = {
  init: { load: () => import("./init"), usage: 'khb init [dir] [--name N] [--description "…"]', desc: "create a hub here (or in dir)" },
  upgrade: { load: () => import("./init"), usage: "khb upgrade", desc: "refresh this hub's contract docs" },
  "new-bundle": { load: () => import("./new-bundle"), usage: 'khb new-bundle <name> ["scope"]', desc: "scaffold a bundle + register it" },
  ingest: {
    load: () => import("./ingest/index"),
    usage: "khb ingest <bundle> [--force]",
    desc: "acquire + extract declared sources → raw/ (name required once the hub has a bundle other than 'default')",
  },
  lint: { load: () => import("./lint"), usage: "khb lint", desc: "validate the hub against skills/lint/SKILL.md" },
  visualize: {
    load: () => import("./visualize"),
    usage: "khb visualize [--port N] [--no-open]",
    desc: "serve the live bundle graph in your browser; aliases: vis, viz",
  },
  export: { load: () => import("./export"), usage: "khb export <bundle> [dest]", desc: "standalone copy of one bundle" },
  list: { load: () => import("./hubs"), usage: "khb list [--json]", desc: "every hub on this machine" },
  go: { load: () => import("./hubs"), usage: "khb go [name|N] [--path]", desc: "open a hub with your agent (bare 'khb' picks one)" },
  agent: { load: () => import("./hubs"), usage: "khb agent [name] [--command X]", desc: "which agent 'khb go' launches" },
  "update-path": {
    load: () => import("./hubs"),
    usage: "khb update-path [new] [--dry-run]",
    desc: "you MOVED a hub: repair the list + paths inside it",
  },
  forget: { load: () => import("./hubs"), usage: "khb forget <name>", desc: "drop a hub from the list (folder untouched)" },
};

/**
 * Commands that work *outside* a hub, against ~/.khb/hubs-config.json. They must not
 * resolve or upgrade a hub — their whole job is running before you are in one.
 */
const REGISTRY_COMMANDS = new Set(["list", "go", "agent", "forget", "update-path"]);

// Short forms that just resolve to a canonical command above — kept out of COMMANDS
// itself so help text lists each command once. `-v` is taken by --version, so
// `visualize` gets word-shaped aliases instead of a letter one.
const ALIASES: Record<string, string> = { vis: "visualize", viz: "visualize" };

const argv = process.argv.slice(2);

// --hub <dir> is global: strip it here so subcommands never see it, and hand it to
// util.ts through the environment (same channel as $KHB_HUB).
const hubAt = argv.indexOf("--hub");
if (hubAt >= 0) {
  const dir = argv[hubAt + 1];
  if (!dir) {
    console.error("--hub needs a directory");
    process.exit(1);
  }
  process.env.KHB_HUB = dir;
  argv.splice(hubAt, 2);
}

const cmd0 = argv.shift();
// Bare `khb` is the way in from a cold terminal: pick a hub and open it. Help stays one
// word away, and is what you get when no hub has ever been registered.
const cmd = !cmd0 ? "go" : (ALIASES[cmd0] ?? cmd0);

if (cmd === "help" || cmd === "--help" || cmd === "-h") {
  const width = Math.max(...Object.values(COMMANDS).map((c) => c.usage.length));
  const printSection = (title: string, names: string[]) => {
    console.log(title);
    for (const name of names) {
      const c = COMMANDS[name];
      console.log(`  ${c.usage.padEnd(width)}   ${c.desc}`);
    }
  };

  console.log(`khb ${version()} — Knowledge Hub Builder`);
  console.log();
  console.log(`khb is the supporting tool: it handles deterministic extraction, file plumbing,`);
  console.log(`validation, and export. Your AI agent — Claude, Codex, Gemini, or another`);
  console.log(`compatible agent — follows the workflow skills and orchestrates the knowledge work.`);
  console.log();

  printSection(
    "In a hub:",
    Object.keys(COMMANDS).filter((name) => !REGISTRY_COMMANDS.has(name)),
  );
  console.log();
  printSection(
    "Anywhere on this machine (no hub needed) — config and maintenance:",
    Object.keys(COMMANDS).filter((name) => REGISTRY_COMMANDS.has(name)),
  );
  console.log();

  console.log(`Global:  --hub <dir>   operate on that hub instead of searching upward from cwd`);
  console.log(`Docs:    https://github.com/msareen/knowledge-hub-builder`);
  process.exit(0);
}

if (cmd === "--version" || cmd === "-v") {
  console.log(version());
  process.exit(0);
}

const entry = COMMANDS[cmd];
if (!entry) {
  console.error(`Unknown command: ${cmd}`);
  console.error(`Try: khb help`);
  process.exit(1);
}

// Version drift: a hub carries package-owned copies of the agent contract, and a hub
// stamped at an older version than the installed khb is stating an older contract than
// the one the CLI now implements. Rather than let the two disagree, refresh the hub in
// place before running the command — `khb upgrade` touches nothing the user wrote.
// `init` has no hub yet, `upgrade` does this itself, the registry commands run outside
// any hub, and $KHB_NO_AUTO_UPGRADE opts out.
if (cmd !== "init" && cmd !== "upgrade" && !REGISTRY_COMMANDS.has(cmd)) {
  const hub = findHub();
  if (hub) {
    // Any command run in a hub is proof the hub exists and is in use — record it, so the
    // machine registry fills itself in without a migration or a `khb register` to recall.
    const { registerHub, touchHub } = await import("./lib/registry");
    registerHub(hub);
    touchHub(hub);

    // …and proof of where it is. The hub records its own location in its marker, so a move
    // is noticed by the hub itself rather than inferred from a registry that may have been
    // deleted or never have seen this machine. Must run before the drift check below:
    // that restamps the marker, and would overwrite the old location before anyone read it.
    const { recordLocation } = await import("./lib/upgrade");
    const { moved } = recordLocation(hub);
    if (moved) {
      console.error(`khb: this hub was at ${moved} and is now at ${hub}.`);
      console.error(`khb:   absolute paths recorded inside it still name the old location.`);
      console.error(`khb:   repair them:  khb update-path            (--dry-run to preview)`);
    }
  }
  if (hub && !process.env.KHB_NO_AUTO_UPGRADE) {
    const { hubVersion, upgradeHub } = await import("./lib/upgrade");
    // A marker under a pre-rename name is drift too, even at a matching version.
    if (hubVersion(hub) !== version() || markerIn(hub) !== MARKER) {
      const { from, to, pruned, renamed } = upgradeHub(hub);
      // stderr, so a command's own output stays pipeable.
      console.error(
        `khb: hub was built by ${from ?? "an unknown version"}, khb is ${to} — refreshed its contract docs.`,
      );
      if (renamed) console.error(`khb:   renamed ${renamed} -> khb.json`);
      if (pruned.length) console.error(`khb:   removed (no longer part of the contract): ${pruned.join(", ")}`);
    }
  }
}

// Subcommand modules parse process.argv.slice(2) themselves — reshape it so they see
// their own arguments and not the subcommand name.
process.argv = [process.argv[0], process.argv[1], ...argv];
process.env.KHB_SUBCOMMAND = cmd;
await entry.load();
