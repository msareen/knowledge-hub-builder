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
import { takeOpt, takeFlag, rejectUnknownFlags } from "./lib/args";
import { paint, paintErr } from "./lib/color";

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
// Opt-in, and only here: khb never installs software on its own initiative, but `init` is
// the user saying "set this up". See the note at the call site below.
const withOneNote = upgrading ? false : takeFlag(argv, "--with-onenote");
rejectUnknownFlags(
  argv,
  upgrading ? "khb upgrade" : 'khb init [dir] [--name N] [--description "…"] [--with-onenote]',
);
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
    console.log(
      `${paint.warn("This hub was at")} ${paint.path(moved)} and is now at ${paint.path(HUB)}.`,
    );
    console.log(`  absolute paths recorded inside it still name the old location.`);
    console.log(
      `  repair them:  ${paint.cmd("khb update --path")}           ${paint.dim("(--dry-run to preview)")}`,
    );
  }

  const { from, to, synced, pruned, renamed } = upgradeHub(HUB);
  console.log(`${paint.ok("Upgraded")} ${paint.path(HUB)}: ${from ?? "?"} -> ${paint.name(to)}`);
  // An empty list is not an empty result: in the khb development repo the package *is* the
  // hub, so every managed path is its own source and there is genuinely nothing to copy.
  // Printing a bare "refreshed:" there reads as a failure rather than as the no-op it is.
  console.log(
    synced.length
      ? `  refreshed: ${synced.join(", ")}`
      : `  refreshed: nothing to copy — this hub is its own package`,
  );
  if (renamed) console.log(`  renamed: ${renamed} -> ${MARKER}`);
  if (pruned.length) console.log(`  removed (no longer part of the contract): ${pruned.join(", ")}`);
  console.log(`Your bundles/ and outer.index.md were not touched. Next: ${paint.cmd("khb lint")}`);
  const hint = updateHint(HUB);
  if (hint) console.log(hint);
} else {
  const hub = resolve(dirArg ?? process.cwd());

  if (markerIn(hub)) {
    console.error(`${paintErr.bad("Already a KHB hub:")} ${paintErr.path(hub)}`);
    console.error(`To refresh its contract docs:   ${paintErr.cmd("khb upgrade")}`);
    process.exit(1);
  }

  const { createHub } = await import("./lib/create");
  const { synced, entry } = createHub(hub, { name: nameOpt, description: descOpt });

  console.log(`${paint.ok("Hub created:")} ${paint.path(hub)}`);
  console.log(`  khb.json, outer.index.md, bundles/, .gitignore, .gitattributes`);
  console.log(`  contract docs (package-owned, refreshed by 'khb upgrade'): ${synced.join(", ")}`);

  // Asked for, and forgiving in every direction. khb's own extractors need no setup and its
  // transcriber is left to the user (skills/ingest/SKILL.md); pyOneNote is the one python
  // dependency, so `--with-onenote` exists for the moment someone is already setting up. It
  // cannot fail the command: the hub above is the deliverable, and an extractor that could
  // not be installed is a printed pip line, not a half-made hub.
  if (withOneNote) {
    const { installPyOneNote, PYONENOTE_INSTALL } = await import("./lib/pyonenote");
    const result = await installPyOneNote();
    const manually = `  install it yourself when convenient:  ${paint.cmd(PYONENOTE_INSTALL)}`;
    if (result.status === "already")
      console.log(`\n${paint.ok("OneNote:")} pyOneNote is already installed (${result.bin}) — .one sections will be read.`);
    else if (result.status === "installed")
      console.log(
        `\n${paint.ok("OneNote:")} pyOneNote installed for ${result.bin}` +
          `${result.userSite ? " (into your user site-packages)" : ""} — .one sections will be read.`,
      );
    else if (result.status === "no-python") {
      console.log(`\n${paint.warn("OneNote:")} no python on PATH, so pyOneNote was not installed.`);
      console.log(`  install python 3, then:  ${paint.cmd(PYONENOTE_INSTALL)}`);
    } else if (result.status === "no-pip") {
      console.log(`\n${paint.warn("OneNote:")} ${result.bin} has no pip, so pyOneNote was not installed.`);
      console.log(manually);
    } else {
      console.log(`\n${paint.warn("OneNote:")} pyOneNote could not be installed — ${result.reason}`);
      console.log(manually);
    }
    console.log(`  everything else ingests either way; .one files pend with the reason until it is there.`);
  }

  console.log(`\n${paint.head("Next")}:`);
  console.log(`  ${paint.cmd(`cd ${basename(hub)}`)}`);
  console.log(`  ${paint.cmd("git init")}                              ${paint.dim("# optional, but recommended")}`);
  console.log(
    `  ${paint.cmd('khb new-bundle <name> "<scope>"')}       ${paint.dim("# your first bundle")}`,
  );
  console.log(`\nThen open this folder with Claude or Codex — both load AGENTS.md and the workflow skills.`);
  console.log(
    `Registered as ${paint.name(`"${entry.name}"`)} — from any terminal, '${paint.cmd("khb")}' comes back here and starts your agent.`,
  );

  // Everything khb extracts works out of the box except OneNote, so this is the one gap
  // worth naming while the user is still setting up. Printed only when it *is* a gap, and
  // skipped entirely when --with-onenote already reported above.
  if (!withOneNote) {
    const { oneNoteHint } = await import("./lib/pyonenote");
    const hint = await oneNoteHint();
    if (hint) console.log(`\n${hint}`);
  }
}
