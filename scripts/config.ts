// khb config — view, edit, check and repair the machine-level config.
//
// ~/.khb/hubs-config.json is the only khb file that is neither knowledge nor package-owned:
// it is this machine's shortcut list plus the agent `khb go` launches. It has always been
// hand-editable — the README says where it lives and what is in it — but nothing pointed at
// it from the CLI, and nothing ever told you when a hand edit had gone wrong. `loadConfig`
// is forgiving by design (unknown keys ignored, unparseable file treated as empty), so a
// typo costs you your hub list with no message at all.
//
// So: `view` and `edit` to reach it without hunting for the path, `check` to say what is
// wrong, `fix` to repair what can be repaired mechanically. The rules live once, in
// lib/config-check.ts, and `khb doctor` reads the same checker — doctor reports and never
// writes, this is where the writing happens.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { checkConfig, pruneDead, type Finding } from "./lib/config-check";
import { CONFIG, KHB_HOME, loadConfig, saveConfig } from "./lib/registry";
import { takeFlag, rejectUnknownFlags } from "./lib/args";
import { detail, section, totalElapsed } from "./lib/log";
import { paint, paintErr } from "./lib/color";

const USAGE = "khb config [view|edit|check|fix|path] [--json] [--dry-run] [--prune]";
const argv = process.argv.slice(2);

const asJson = takeFlag(argv, "--json");
const dryRun = takeFlag(argv, "--dry-run");
const prune = takeFlag(argv, "--prune");
rejectUnknownFlags(argv, USAGE);

// Bare `khb config` shows the file. A command whose default action is read-only is the
// right default for the one file whose corruption costs you every shortcut you have.
const action = argv[0] ?? "view";
if (argv.length > 1) {
  console.error(`${paintErr.bad("Too many arguments:")} ${argv.slice(1).join(" ")}`);
  console.error(`Usage: ${paintErr.cmd(USAGE)}`);
  process.exit(1);
}

/** Ensure the file exists before anyone is told to look at it — first run has none. */
function ensureExists(): void {
  if (!existsSync(CONFIG)) saveConfig(loadConfig());
}

function printFinding(finding: Finding): void {
  const tag = finding.level === "error" ? paint.bad("ERROR") : paint.warn("warn ");
  console.log(`  ${tag} ${finding.what}`);
  console.log(`        ${paint.dim(finding.repair ? "fix (automatic):" : "fix:")} ${paint.cmd(finding.fix)}`);
}

/** The closing line every action shares: how many findings stand, and what clears them. */
function summarize(findings: Finding[]): void {
  const errors = findings.filter((finding) => finding.level === "error").length;
  const repairable = findings.filter((finding) => finding.repair).length;
  if (!findings.length) {
    console.log(`\n${paint.ok("no problems found")} in ${totalElapsed()}`);
    return;
  }
  console.log(
    `\n${paint.head("config")}: ${errors ? paint.bad(`${errors} error(s)`) : paint.ok("0 errors")}, ` +
      `${paint.warn(`${findings.length - errors} warning(s)`)} in ${totalElapsed()}`,
  );
  if (repairable)
    console.log(`${repairable} of them can be repaired for you:  ${paint.cmd("khb config fix")}`);
}

// ------------------------------------------------------------------------------- path

if (action === "path") {
  // Deliberately bare, so `cat "$(khb config path)"` works. Nothing else on stdout.
  console.log(CONFIG);
  process.exit(0);
}

// ------------------------------------------------------------------------------- view

if (action === "view") {
  ensureExists();
  const text = readFileSync(CONFIG, "utf8");
  if (asJson) {
    // The file itself, verbatim — pipeable into jq. No header, no findings.
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
    process.exit(0);
  }
  console.log(`${paint.head("khb config")} → ${paint.path(CONFIG)}\n`);
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);

  const { findings } = checkConfig({ probeAgent: false });
  if (findings.length) {
    console.log(
      `\n${paint.warn(`${findings.length} finding(s)`)} — see them in full:  ${paint.cmd("khb config check")}`,
    );
  }
  console.log(paint.dim(`Edit it:  khb config edit        Repair it:  khb config fix`));
  process.exit(0);
}

// ------------------------------------------------------------------------------- edit

if (action === "edit") {
  ensureExists();
  console.log(`${paint.head("khb config")} → ${paint.path(CONFIG)}`);

  // The OS association, the same way `khb visualize` opens a browser: whatever this machine
  // already opens a .json with is the editor the person has actually chosen. $EDITOR is not
  // consulted — a terminal editor launched detached would draw over this session.
  const command =
    process.platform === "win32"
      ? ["cmd", "/c", "start", "", CONFIG] // the empty string is start's window-title argument
      : process.platform === "darwin"
        ? ["open", CONFIG]
        : ["xdg-open", CONFIG];

  const launched = spawnSync(command[0], command.slice(1), { stdio: "ignore" });
  if (launched.error || (launched.status ?? 0) !== 0) {
    console.error(`\n${paintErr.warn("Could not open an editor")} — open the path above yourself.`);
    process.exit(1);
  }

  console.log(`  ${paint.dim("opened in your default editor for .json")}`);
  // The editor is detached, so khb cannot wait for the save and validate it. Say what to run
  // instead — a config that stops parsing is silently treated as empty, which is exactly the
  // failure someone editing by hand is most likely to cause and least likely to notice.
  console.log(`\nWhen you have saved it:  ${paint.cmd("khb config check")}`);
  console.log(paint.dim(`An unparseable file is ignored in full — khb would act as if you had no hubs.`));
  process.exit(0);
}

// ------------------------------------------------------------------------------ check

if (action === "check") {
  console.log(`${paint.head("khb config check")} → ${paint.path(CONFIG)}`);
  const report = checkConfig();
  if (!report.exists) {
    detail(`no config yet — it is written the first time khb registers a hub`);
    process.exit(0);
  }
  section(report.findings.length ? `Findings (${report.findings.length})` : "Findings");
  if (!report.findings.length) detail(paint.ok("none — nothing here needs attention."));
  else for (const finding of report.findings) printFinding(finding);
  summarize(report.findings);
  // Exit 0 with findings, like `khb lint` and `khb doctor`: the exit code says the command
  // ran, not that the thing it inspected is perfect.
  process.exit(0);
}

// -------------------------------------------------------------------------------- fix

if (action === "fix") {
  console.log(`${paint.head("khb config fix")}${dryRun ? paint.dim(" (dry run)") : ""} → ${paint.path(CONFIG)}`);
  const first = checkConfig();
  if (!first.exists) {
    detail(`no config yet — nothing to repair`);
    process.exit(0);
  }
  if (!first.readable) {
    // Every repair works on the parsed config, and there is none. Rewriting from the
    // normalized (empty) view would silently delete every shortcut in the file.
    section("Findings");
    for (const finding of first.findings) printFinding(finding);
    console.log(`\n${paintErr.bad("Nothing can be repaired while the file does not parse.")}`);
    console.log(`Fix the JSON by hand:  ${paint.cmd("khb config edit")}`);
    process.exit(1);
  }

  section("Repairs");
  const applied: string[] = [];
  // One repair per pass, re-checking in between. Repairs interact — canonicalizing a path
  // changes the key a later repair looks its entry up by, and merging a duplicate shifts
  // every index after it — so the honest way to apply a set of them is to apply one and
  // ask again. It converges: each pass either clears a finding or stops.
  let previous = "";
  for (let pass = 0; pass < 100; pass++) {
    const { findings } = checkConfig({ probeAgent: false });
    const next = findings.find((finding) => finding.repair);
    if (!next) break;
    if (next.what === previous) {
      // The repair ran and the finding came back: report it rather than loop.
      console.log(`  ${paint.warn("could not repair:")} ${next.what}`);
      break;
    }
    previous = next.what;
    if (dryRun) {
      // Nothing is written, so re-checking would return the same finding forever. Show the
      // whole repairable set in one go instead of walking it.
      for (const finding of findings.filter((each) => each.repair))
        console.log(`  ${paint.dim("would fix:")} ${finding.what}`);
      break;
    }
    const cfg = loadConfig();
    next.repair!(cfg);
    saveConfig(cfg);
    applied.push(next.what);
    console.log(`  ${paint.ok("fixed:")} ${next.what}`);
  }

  if (prune) {
    const cfg = loadConfig();
    const dead = pruneDead(cfg);
    if (!dead.length) detail(`--prune: no dead shortcuts to drop`);
    else if (dryRun)
      for (const entry of dead)
        console.log(`  ${paint.dim("would drop:")} ${entry.name} (${entry.path})`);
    else {
      saveConfig(cfg);
      for (const entry of dead)
        console.log(`  ${paint.ok("dropped:")} ${entry.name} ${paint.path(`(${entry.path})`)}`);
      console.log(paint.dim(`  the folders themselves are untouched`));
    }
  }

  if (!applied.length && !dryRun) detail(`nothing to repair automatically`);

  // What is left is what needed a person. Say so explicitly rather than reporting success
  // on a config that still has problems in it.
  const after = checkConfig();
  const manual = after.findings.filter((finding) => !finding.repair);
  if (manual.length) {
    section(`Left for you (${manual.length})`);
    for (const finding of manual) printFinding(finding);
  }
  summarize(after.findings);
  if (dryRun) console.log(`Re-run without ${paint.cmd("--dry-run")} to apply.`);
  process.exit(0);
}

console.error(`${paintErr.bad("Unknown action:")} ${action}`);
console.error(`Usage: ${paintErr.cmd(USAGE)}`);
console.error(`The config lives at ${paintErr.path(CONFIG)} (${paintErr.dim(`$KHB_HOME is ${KHB_HOME}`)})`);
process.exit(1);
