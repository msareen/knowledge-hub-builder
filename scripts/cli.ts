#!/usr/bin/env bun
// khb — the CLI. Subcommands are loaded lazily: `init` must run before a hub exists,
// so nothing that resolves a hub may be imported at module scope.
import { version, findHub, markerIn, MARKER } from "./lib/paths";
import { paint, paintErr } from "./lib/color";

const COMMANDS: Record<string, { load: () => Promise<unknown>; usage: string; desc: string }> = {
  init: { load: () => import("./init"), usage: 'khb init [dir] [--name N] [--description "…"]', desc: "create a hub here (or in dir)" },
  upgrade: { load: () => import("./init"), usage: "khb upgrade", desc: "refresh this hub's contract docs" },
  "new-bundle": { load: () => import("./new-bundle"), usage: 'khb new-bundle <name> ["scope"]', desc: "scaffold a bundle + register it" },
  ingest: {
    load: () => import("./ingest/index"),
    usage: "khb ingest [bundle] [--force] [--skip-ocr] [--skip-audio]",
    desc: "acquire + extract declared sources → raw/",
  },
  lint: { load: () => import("./lint"), usage: "khb lint", desc: "validate the hub against skills/lint/SKILL.md" },
  doctor: { load: () => import("./doctor"), usage: "khb doctor", desc: "read-only report on this hub's state" },
  visualize: {
    load: () => import("./visualize"),
    usage: "khb visualize [--port N] [--no-open]",
    desc: "serve the live bundle graph in your browser; aliases: vis, viz",
  },
  export: { load: () => import("./export"), usage: "khb export <bundle> [dest]", desc: "standalone copy of one bundle" },
  list: { load: () => import("./hubs"), usage: "khb list [--json]", desc: "every hub on this machine" },
  go: {
    load: () => import("./hubs"),
    usage: "khb go [name|N] [--path] [--no-agent] [--agent X] [--respond|-r] [--file|-f <path>]",
    desc: "open a hub with your agent (bare 'khb' picks one); --respond saves a session write-up back here",
  },
  agent: {
    load: () => import("./hubs"),
    usage: 'khb agent [name|none] [--command X] [--args "…"] [--respond-args "…"]',
    desc: "which agent 'khb go' launches, and how it continues a session for --respond",
  },
  update: {
    load: () => import("./hubs"),
    usage: "khb update [new-path] [--path|-p] [--schema|-s] [--from <old>] [--dry-run]",
    desc: "repair a moved hub's paths, and/or backfill sources.yaml",
  },
  forget: {
    load: () => import("./hubs"),
    usage: "khb forget <name|path> [more…]",
    desc: "drop one or more hubs from the list (folders untouched)",
  },
  config: {
    load: () => import("./config"),
    usage: "khb config [view|edit|check|fix|path]",
    desc: "the machine config: show it, open it, validate it, repair it",
  },
};

/**
 * Commands that work *outside* a hub, against ~/.khb/hubs-config.json. They must not
 * resolve or upgrade a hub — their whole job is running before you are in one.
 */
const REGISTRY_COMMANDS = new Set(["list", "go", "agent", "forget", "update", "config"]);

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
  // Descriptions align to the longest usage — but only among those that fit. One long
  // entry should not push every other description off an 80-column terminal: past the
  // cap, that entry gets its own line for the usage and an indented line for the
  // description, instead of dragging the whole column wide.
  const CAP = 60;
  const usages = Object.values(COMMANDS).map((c) => c.usage.length);
  const width = Math.max(...usages.filter((n) => n <= CAP));
  const printSection = (title: string, names: string[]) => {
    console.log(paint.head(title));
    for (const name of names) {
      const entry = COMMANDS[name];
      // Pad before painting: escape sequences have width in the string and none on screen.
      if (entry.usage.length > width) {
        console.log(`  ${paint.cmd(entry.usage)}`);
        console.log(`  ${" ".repeat(width)}   ${entry.desc}`);
      } else {
        console.log(`  ${paint.cmd(entry.usage.padEnd(width))}   ${entry.desc}`);
      }
    }
  };

  console.log(`${paint.head(`khb ${version()}`)} — Knowledge Hub Builder`);
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

  const label = (text: string) => paint.head(text.padEnd(9));
  console.log(`${label("Global:")}${paint.cmd("--hub <dir>")}              operate on that hub instead of searching upward from cwd`);
  console.log(`${" ".repeat(9)}${paint.cmd("help | --help | -h")}       this help          ${paint.cmd("--version | -v")}   version`);
  console.log(`${label("Env:")}${paint.cmd("KHB_HUB")}                  same as --hub`);
  console.log(`${" ".repeat(9)}${paint.cmd("KHB_HOME")}                 where the hub list lives (default ~/.khb)`);
  console.log(`${" ".repeat(9)}${paint.cmd("KHB_NO_AUTO_UPGRADE")}      don't refresh a hub's contract docs on version drift`);
  console.log(`${label("Colour:")}on when stdout is a terminal — ${paint.cmd("NO_COLOR")} turns it off, ${paint.cmd("FORCE_COLOR")} forces it on`);
  console.log(`${label("Exit:")}0 on success, 1 on a usage error or a failure. An unknown option is an error;`);
  console.log(`${" ".repeat(9)}a source khb cannot extract is not — it becomes a pending row in log.md.`);
  console.log(`${label("Docs:")}${paint.path("https://github.com/msareen/knowledge-hub-builder")}`);
  process.exit(0);
}

if (cmd === "--version" || cmd === "-v") {
  console.log(version());
  process.exit(0);
}

const entry = COMMANDS[cmd];
if (!entry) {
  console.error(`${paintErr.bad("Unknown command:")} ${cmd}`);
  console.error(`Try: ${paintErr.cmd("khb help")}`);
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
      console.error(
        `${paintErr.warn("khb:")} this hub was at ${paintErr.path(moved)} and is now at ${paintErr.path(hub)}.`,
      );
      console.error(`${paintErr.warn("khb:")}   absolute paths recorded inside it still name the old location.`);
      console.error(
        `${paintErr.warn("khb:")}   repair them:  ${paintErr.cmd("khb update --path")}           (--dry-run to preview)`,
      );
    }
  }
  if (hub && !process.env.KHB_NO_AUTO_UPGRADE) {
    const { hubVersion, upgradeHub, updateHint } = await import("./lib/upgrade");
    // A marker under a pre-rename name is drift too, even at a matching version.
    if (hubVersion(hub) !== version() || markerIn(hub) !== MARKER) {
      const { from, to, pruned, renamed } = upgradeHub(hub);
      // stderr, so a command's own output stays pipeable.
      console.error(
        `${paintErr.warn("khb:")} hub was built by ${from ?? "an unknown version"}, khb is ${to} — refreshed its contract docs.`,
      );
      if (renamed) console.error(`${paintErr.warn("khb:")}   renamed ${renamed} -> khb.json`);
      if (pruned.length)
        console.error(
          `${paintErr.warn("khb:")}   removed (no longer part of the contract): ${pruned.join(", ")}`,
        );
      const hint = updateHint(hub);
      if (hint) console.error(hint);
    }
  }
}

// Subcommand modules parse process.argv.slice(2) themselves — reshape it so they see
// their own arguments and not the subcommand name.
process.argv = [process.argv[0], process.argv[1], ...argv];
process.env.KHB_SUBCOMMAND = cmd;
await entry.load();
