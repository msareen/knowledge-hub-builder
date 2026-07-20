#!/usr/bin/env bun
// bkr — the CLI. Subcommands are loaded lazily: `init` must run before a hub exists,
// so nothing that resolves a hub may be imported at module scope.
import { version } from "./lib/paths";

const COMMANDS: Record<string, { load: () => Promise<unknown>; help: string }> = {
  init: { load: () => import("./init"), help: "bkr init [dir]                  create a hub here (or in dir)" },
  upgrade: { load: () => import("./init"), help: "bkr upgrade                     refresh this hub's contract docs" },
  "new-bundle": { load: () => import("./new-bundle"), help: 'bkr new-bundle <name> ["scope"]  scaffold a bundle + register it' },
  ingest: { load: () => import("./ingest/index"), help: "bkr ingest <bundle> [--force]   acquire declared sources → raw/" },
  triage: { load: () => import("./triage"), help: "bkr triage <path...>            index a corpus in place (copies nothing)" },
  route: { load: () => import("./route"), help: "bkr route                       apply inbox/routing.yaml → sources.yaml" },
  lint: { load: () => import("./lint"), help: "bkr lint                        validate the hub against lint.md" },
  visualize: { load: () => import("./visualize"), help: "bkr visualize                   regenerate visualizer/graph.html" },
  export: { load: () => import("./export"), help: "bkr export <bundle> [dest]      standalone copy of one bundle" },
};

const argv = process.argv.slice(2);

// --hub <dir> is global: strip it here so subcommands never see it, and hand it to
// util.ts through the environment (same channel as $BKR_HUB).
const hubAt = argv.indexOf("--hub");
if (hubAt >= 0) {
  const dir = argv[hubAt + 1];
  if (!dir) {
    console.error("--hub needs a directory");
    process.exit(1);
  }
  process.env.BKR_HUB = dir;
  argv.splice(hubAt, 2);
}

const cmd = argv.shift();

if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
  console.log(`bkr ${version()} — Bundled Knowledge Routing, a knowledge hub builder\n`);
  for (const c of Object.values(COMMANDS)) console.log("  " + c.help);
  console.log(`\nGlobal:  --hub <dir>   operate on that hub instead of searching upward from cwd`);
  console.log(`Docs:    https://github.com/msareen/bundle-knowledge-router`);
  process.exit(0);
}

if (cmd === "--version" || cmd === "-v") {
  console.log(version());
  process.exit(0);
}

const entry = COMMANDS[cmd];
if (!entry) {
  console.error(`Unknown command: ${cmd}`);
  console.error(`Try: bkr help`);
  process.exit(1);
}

// Subcommand modules parse process.argv.slice(2) themselves — reshape it so they see
// their own arguments and not the subcommand name.
process.argv = [process.argv[0], process.argv[1], ...argv];
process.env.BKR_SUBCOMMAND = cmd;
await entry.load();
