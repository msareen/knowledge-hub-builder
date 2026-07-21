// bkr init [dir] / bkr upgrade — create a hub, or refresh a hub's package-owned files.
//
// A hub is the user's knowledge: bkr.json + outer.index.md + bundles/. The bkr package
// holds no knowledge, so the contract docs an agent needs (AGENT.md, skills/, …) are
// copied INTO the hub — an agent opened on the hub folder must be able to read them
// without knowing where bkr is installed. Those copies are package-owned: `upgrade`
// overwrites them.
import { cpSync, mkdirSync, writeFileSync, existsSync, statSync, rmSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { PKG, HUB_TEMPLATE, MANAGED, RETIRED, MARKER, version } from "./lib/paths";

const upgrading = process.env.BKR_SUBCOMMAND === "upgrade";
const [dirArg] = process.argv.slice(2);

/** Copy every package-owned contract file into the hub, replacing what is there. */
function syncManaged(hub: string): string[] {
  const done: string[] = [];
  for (const f of MANAGED) {
    const src = join(PKG, f);
    if (!existsSync(src)) continue;
    cpSync(src, join(hub, f), { recursive: true, force: true });
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
      { bkr: version(), created: created ?? new Date().toISOString(), upgraded: new Date().toISOString() },
      null,
      2,
    ) + "\n",
  );
}

if (upgrading) {
  const { HUB } = await import("./lib/util"); // resolves the hub, or exits with guidance
  const before = JSON.parse(await Bun.file(join(HUB, MARKER)).text());
  const synced = syncManaged(HUB);
  const pruned = pruneRetired(HUB);
  stamp(HUB, before.created);
  console.log(`Upgraded ${HUB}: ${before.bkr ?? "?"} -> ${version()}`);
  console.log(`  refreshed: ${synced.join(", ")}`);
  if (pruned.length) console.log(`  removed (no longer part of the contract): ${pruned.join(", ")}`);
  console.log(`Your bundles/ and outer.index.md were not touched. Next: bkr lint`);
} else {
  const hub = resolve(dirArg ?? process.cwd());

  if (existsSync(join(hub, MARKER))) {
    console.error(`Already a BKR hub: ${hub}`);
    console.error(`To refresh its contract docs:   bkr upgrade`);
    process.exit(1);
  }

  mkdirSync(join(hub, "bundles"), { recursive: true });
  cpSync(join(HUB_TEMPLATE, "outer.index.md"), join(hub, "outer.index.md"));
  // Dotfiles: shipped unprefixed so npm doesn't swallow them, renamed on the way in.
  // Never clobber — `bkr init` may be run inside a folder that is already a git repo.
  for (const f of ["gitignore", "gitattributes"])
    if (!existsSync(join(hub, `.${f}`))) cpSync(join(HUB_TEMPLATE, f), join(hub, `.${f}`));
  const synced = syncManaged(hub);
  stamp(hub);

  console.log(`Hub created: ${hub}`);
  console.log(`  bkr.json, outer.index.md, bundles/, .gitignore, .gitattributes`);
  console.log(`  contract docs (package-owned, refreshed by 'bkr upgrade'): ${synced.join(", ")}`);
  console.log(`\nNext:`);
  console.log(`  cd ${basename(hub)}`);
  console.log(`  git init                              # optional, but recommended`);
  console.log(`  bkr new-bundle <name> "<scope>"       # your first bundle`);
  console.log(`\nThen open this folder with your agent — CLAUDE.md -> AGENT.md tells it the rules.`);
}
