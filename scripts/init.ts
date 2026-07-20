// bkr init [dir] / bkr upgrade — create a hub, or refresh a hub's package-owned files.
//
// A hub is the user's knowledge: bkr.json + outer.index.md + bundles/. The bkr package
// holds no knowledge, so the contract docs an agent needs (AGENT.md, query.md, …) are
// copied INTO the hub — an agent opened on the hub folder must be able to read them
// without knowing where bkr is installed. Those copies are package-owned: `upgrade`
// overwrites them.
import { cpSync, mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { PKG, HUB_TEMPLATE, MANAGED, MARKER, version } from "./lib/paths";

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
  stamp(HUB, before.created);
  console.log(`Upgraded ${HUB}: ${before.bkr ?? "?"} -> ${version()}`);
  console.log(`  refreshed: ${synced.join(", ")}`);
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
  if (!existsSync(join(hub, ".gitignore"))) cpSync(join(HUB_TEMPLATE, "gitignore"), join(hub, ".gitignore"));
  const synced = syncManaged(hub);
  stamp(hub);

  console.log(`Hub created: ${hub}`);
  console.log(`  bkr.json, outer.index.md, bundles/, .gitignore`);
  console.log(`  contract docs (package-owned, refreshed by 'bkr upgrade'): ${synced.join(", ")}`);
  console.log(`\nNext:`);
  console.log(`  cd ${basename(hub)}`);
  console.log(`  git init                              # optional, but recommended`);
  console.log(`  bkr new-bundle <name> "<scope>"       # your first bundle`);
  console.log(`\nThen open this folder with your agent — CLAUDE.md -> AGENT.md tells it the rules.`);
}
