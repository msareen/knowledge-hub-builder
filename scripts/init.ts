// khb init [dir] / khb upgrade — create a hub, or refresh a hub's package-owned files.
//
// A hub is the user's knowledge: khb.json + outer.index.md + bundles/. The khb package
// holds no knowledge, so the contract docs an agent needs (AGENTS.md, skills/, …) are
// copied INTO the hub — an agent opened on the hub folder must be able to read them
// without knowing where khb is installed. Those copies are package-owned: `upgrade`
// overwrites them.
import { cpSync, mkdirSync, writeFileSync, existsSync, statSync, rmSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { PKG, HUB_TEMPLATE, MANAGED, RETIRED, MARKER, markerIn, version } from "./lib/paths";

const upgrading = process.env.KHB_SUBCOMMAND === "upgrade";
const [dirArg] = process.argv.slice(2);

/** Copy every package-owned contract file into the hub, replacing what is there. */
function syncManaged(hub: string): string[] {
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

function stamp(hub: string, created?: string) {
  writeFileSync(
    join(hub, MARKER),
    JSON.stringify(
      { khb: version(), created: created ?? new Date().toISOString(), upgraded: new Date().toISOString() },
      null,
      2,
    ) + "\n",
  );
}

if (upgrading) {
  const { HUB } = await import("./lib/util"); // resolves the hub, or exits with guidance
  // The hub may still carry a marker name from an older version; stamp() writes MARKER,
  // so drop the old file rather than leaving the hub with two.
  const found = markerIn(HUB)!;
  const before = JSON.parse(await Bun.file(join(HUB, found)).text());
  if (found !== MARKER) rmSync(join(HUB, found));
  const synced = syncManaged(HUB);
  const pruned = pruneRetired(HUB);
  stamp(HUB, before.created);
  console.log(`Upgraded ${HUB}: ${before.khb ?? before.bkr ?? "?"} -> ${version()}`);
  console.log(`  refreshed: ${synced.join(", ")}`);
  if (found !== MARKER) console.log(`  renamed: ${found} -> ${MARKER}`);
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
