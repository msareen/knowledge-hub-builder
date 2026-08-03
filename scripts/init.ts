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
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { HUB_TEMPLATE, MARKER, markerIn } from "./lib/paths";
import { upgradeHub, syncManaged, stamp } from "./lib/upgrade";

const upgrading = process.env.KHB_SUBCOMMAND === "upgrade";
const [dirArg] = process.argv.slice(2);

if (upgrading) {
  const { HUB } = await import("./lib/util"); // resolves the hub, or exits with guidance
  const { from, to, synced, pruned, renamed } = upgradeHub(HUB);
  console.log(`Upgraded ${HUB}: ${from ?? "?"} -> ${to}`);
  console.log(`  refreshed: ${synced.join(", ")}`);
  if (renamed) console.log(`  renamed: ${renamed} -> ${MARKER}`);
  if (pruned.length) console.log(`  removed (no longer part of the contract): ${pruned.join(", ")}`);
  console.log(`Your bundles/ and outer.index.md were not touched. Next: khb lint`);
} else {
  const hub = resolve(dirArg ?? process.cwd());

  if (markerIn(hub)) {
    console.error(`Already a KHB hub: ${hub}`);
    console.error(`To refresh its contract docs:   khb upgrade`);
    process.exit(1);
  }

  mkdirSync(join(hub, "bundles"), { recursive: true });
  cpSync(join(HUB_TEMPLATE, "outer.index.md"), join(hub, "outer.index.md"));
  // Dotfiles: shipped unprefixed so npm doesn't swallow them, renamed on the way in.
  // Never clobber — `khb init` may be run inside a folder that is already a git repo.
  for (const f of ["gitignore", "gitattributes"])
    if (!existsSync(join(hub, `.${f}`))) cpSync(join(HUB_TEMPLATE, f), join(hub, `.${f}`));
  const synced = syncManaged(hub);
  stamp(hub);

  console.log(`Hub created: ${hub}`);
  console.log(`  khb.json, outer.index.md, bundles/, .gitignore, .gitattributes`);
  console.log(`  contract docs (package-owned, refreshed by 'khb upgrade'): ${synced.join(", ")}`);
  console.log(`\nNext:`);
  console.log(`  cd ${basename(hub)}`);
  console.log(`  git init                              # optional, but recommended`);
  console.log(`  khb new-bundle <name> "<scope>"       # your first bundle`);
  console.log(`\nThen open this folder with Claude or Codex — both load AGENTS.md and the workflow skills.`);
}
