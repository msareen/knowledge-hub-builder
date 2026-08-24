// khb init [dir] / khb upgrade — create a hub, or refresh a hub's package-owned files.
//
// A hub is the user's knowledge: khb.json + outer.index.md + bundles/. The khb package
// holds no knowledge, so the contract docs an agent needs (AGENTS.md, skills/, …) are
// copied INTO the hub — an agent opened on the hub folder must be able to read them
// without knowing where khb is installed. Those copies are package-owned: `upgrade`
// overwrites them.
//
// The mechanism itself lives in lib/upgrade.ts, because cli.ts also runs it on version
// drift before any hub command.
import { resolve, basename } from "node:path";
import { MARKER, markerIn } from "./lib/paths";
import { recordLocation, upgradeHub, updateHint } from "./lib/upgrade";
import { takeOpt, rejectUnknownFlags } from "./lib/args";

const upgrading = process.env.KHB_SUBCOMMAND === "upgrade";
const argv = process.argv.slice(2);

// A hub describes itself in its own marker, and the machine-level registry reads those
// two fields from there — so the label follows the hub when it is moved or cloned onto
// another machine, instead of living only in one laptop's shortcut list.
// Both describe a hub being created, so `upgrade` must not consume them: left in argv they
// are refused below like any other unknown option, instead of being silently swallowed by a
// command whose help says it takes no flags at all.
const nameOpt = upgrading ? undefined : takeOpt(argv, "--name");
const descOpt = upgrading ? undefined : takeOpt(argv, "--description");
rejectUnknownFlags(argv, upgrading ? "khb upgrade" : 'khb init [dir] [--name N] [--description "…"]');
const [dirArg] = argv;

if (upgrading) {
  const { HUB } = await import("./lib/util"); // resolves the hub, or exits with guidance

  // cli.ts runs these two before every *other* in-hub command and skips `upgrade`, on the
  // grounds that upgrade does the refresh itself. Neither of these is the refresh:
  //
  //   - unregistered, a hub you only ever upgrade never appears in `khb list` or `khb go`;
  //   - unrecorded, a hub upgraded right after a move loses the move. `upgradeHub` stamps
  //     the marker with wherever the hub is now, so the old path has to be read — and
  //     appended to `movedFrom` — before that happens, or `khb update --path` is left with
  //     nothing to repair from and the arguments it exists to avoid.
  const { registerHub, touchHub } = await import("./lib/registry");
  registerHub(HUB);
  touchHub(HUB);
  const { moved } = recordLocation(HUB);
  if (moved) {
    console.log(`This hub was at ${moved} and is now at ${HUB}.`);
    console.log(`  absolute paths recorded inside it still name the old location.`);
    console.log(`  repair them:  khb update --path           (--dry-run to preview)`);
  }

  const { from, to, synced, pruned, renamed } = upgradeHub(HUB);
  console.log(`Upgraded ${HUB}: ${from ?? "?"} -> ${to}`);
  console.log(`  refreshed: ${synced.join(", ")}`);
  if (renamed) console.log(`  renamed: ${renamed} -> ${MARKER}`);
  if (pruned.length) console.log(`  removed (no longer part of the contract): ${pruned.join(", ")}`);
  console.log(`Your bundles/ and outer.index.md were not touched. Next: khb lint`);
  const hint = updateHint(HUB);
  if (hint) console.log(hint);
} else {
  const hub = resolve(dirArg ?? process.cwd());

  if (markerIn(hub)) {
    console.error(`Already a KHB hub: ${hub}`);
    console.error(`To refresh its contract docs:   khb upgrade`);
    process.exit(1);
  }

  const { createHub } = await import("./lib/create");
  const { synced, entry } = createHub(hub, { name: nameOpt, description: descOpt });

  console.log(`Hub created: ${hub}`);
  console.log(`  khb.json, outer.index.md, bundles/, .gitignore, .gitattributes`);
  console.log(`  contract docs (package-owned, refreshed by 'khb upgrade'): ${synced.join(", ")}`);
  console.log(`\nNext:`);
  console.log(`  cd ${basename(hub)}`);
  console.log(`  git init                              # optional, but recommended`);
  console.log(`  khb new-bundle <name> "<scope>"       # your first bundle`);
  console.log(`\nThen open this folder with Claude or Codex — both load AGENTS.md and the workflow skills.`);
  console.log(`Registered as "${entry.name}" — from any terminal, 'khb' comes back here and starts your agent.`);
}
