// khb init [dir] / khb upgrade — create a hub, or refresh a hub's package-owned files.
//
// A hub is the user's knowledge: khb.json + outer.index.md + bundles/. The khb package
// holds no knowledge, so the contract docs an agent needs (AGENT.md, query.md, …) are
// copied INTO the hub — an agent opened on the hub folder must be able to read them
// without knowing where khb is installed. Those copies are package-owned: `upgrade`
// overwrites them.
import { cpSync, mkdirSync, writeFileSync, existsSync, statSync, rmSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { PKG, HUB_TEMPLATE, MANAGED, MARKER, MARKERS, version } from "./lib/paths";
import { scaffoldBundle, DEFAULT_PRIMARY, PRIMARY_SCOPE } from "./lib/scaffold";

const upgrading = process.env.KHB_SUBCOMMAND === "upgrade";
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

function stamp(hub: string, created?: string, extra: Record<string, unknown> = {}) {
  writeFileSync(
    join(hub, MARKER),
    JSON.stringify(
      {
        khb: version(),
        created: created ?? new Date().toISOString(),
        upgraded: new Date().toISOString(),
        ...extra,
      },
      null,
      2,
    ) + "\n",
  );
}

if (upgrading) {
  const { HUB, markerPath } = await import("./lib/util"); // resolves the hub, or exits with guidance
  const marker = markerPath(HUB);
  const before = JSON.parse(await Bun.file(marker).text());
  const synced = syncManaged(HUB);
  // `primary` is the user's choice, not a package-owned file — carry it across.
  stamp(HUB, before.created, before.primary ? { primary: before.primary } : {});
  // A hub created as BKR carries bkr.json. stamp() has just written khb.json beside it;
  // drop the old one so the hub has exactly one marker.
  const renamed = basename(marker) !== MARKER;
  if (renamed) rmSync(marker, { force: true });
  console.log(`Upgraded ${HUB}: ${before.khb ?? before.bkr ?? "?"} -> ${version()}`);
  console.log(`  refreshed: ${synced.join(", ")}`);
  if (renamed) console.log(`  marker: ${basename(marker)} -> ${MARKER} (bkr is now khb)`);
  console.log(`Your bundles/ and outer.index.md were not touched. Next: khb lint`);
} else {
  const hub = resolve(dirArg ?? process.cwd());

  const existing = MARKERS.find((m) => existsSync(join(hub, m)));
  if (existing) {
    console.error(`Already a KHB hub (${existing}): ${hub}`);
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
  // Every hub starts with a primary bundle, so there is always somewhere for material to
  // land. Splitting into more bundles is something the corpus earns later — see ingest.md.
  scaffoldBundle(hub, DEFAULT_PRIMARY, PRIMARY_SCOPE);
  stamp(hub, undefined, { primary: DEFAULT_PRIMARY });

  console.log(`Hub created: ${hub}`);
  console.log(`  ${MARKER}, outer.index.md, bundles/, .gitignore, .gitattributes`);
  console.log(`  contract docs (package-owned, refreshed by 'khb upgrade'): ${synced.join(", ")}`);
  console.log(`  bundles/${DEFAULT_PRIMARY}/ — your primary bundle; everything lands here until a topic earns its own`);
  console.log(`\nNext:`);
  console.log(`  cd ${basename(hub)}`);
  console.log(`  git init                              # optional, but recommended`);
  console.log(`  khb triage <path...>                  # point it at your material`);
  console.log(`\nThen open this folder with your agent — CLAUDE.md -> AGENT.md tells it the rules.`);
}
