#!/usr/bin/env bun
// khb — the CLI. Subcommands are loaded lazily: `init` must run before a hub exists,
// so nothing that resolves a hub may be imported at module scope.
import { version } from "./lib/paths";

const COMMANDS: Record<string, { load: () => Promise<unknown>; help: string }> = {
  init: { load: () => import("./init"), help: "khb init [dir]                  create a hub here (or in dir)" },
  upgrade: { load: () => import("./init"), help: "khb upgrade                     refresh this hub's contract docs" },
  "new-bundle": { load: () => import("./new-bundle"), help: 'khb new-bundle <name> ["scope"]  scaffold a bundle + register it' },
  ingest: { load: () => import("./ingest/index"), help: "khb ingest [bundle] [--force]   acquire + extract declared sources → raw/ (default: 'default')" },
  lint: { load: () => import("./lint"), help: "khb lint                        validate the hub against skills/lint/SKILL.md" },
  visualize: { load: () => import("./visualize"), help: "khb visualize [--port N] [--no-open]  serve the live bundle graph in your browser; aliases: vis, viz" },
  export: { load: () => import("./export"), help: "khb export <bundle> [dest]      standalone copy of one bundle" },
};

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
const cmd = cmd0 && ALIASES[cmd0] ? ALIASES[cmd0] : cmd0;

if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
  console.log(`khb ${version()} — Knowledge Hub Builder\n`);
  console.log(`khb is the supporting tool: it handles deterministic extraction, file plumbing,`);
  console.log(`validation, and export. Your AI agent — Claude, Codex, Gemini, or another`);
  console.log(`compatible agent — follows the workflow skills and orchestrates the knowledge work.\n`);
  for (const c of Object.values(COMMANDS)) console.log("  " + c.help);
  console.log(`\nGlobal:  --hub <dir>   operate on that hub instead of searching upward from cwd`);
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

// Subcommand modules parse process.argv.slice(2) themselves — reshape it so they see
// their own arguments and not the subcommand name.
process.argv = [process.argv[0], process.argv[1], ...argv];
process.env.KHB_SUBCOMMAND = cmd;
await entry.load();
