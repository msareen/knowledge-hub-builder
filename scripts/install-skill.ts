// khb install-skill — put the global `khb` skill where Claude, Codex and Gemini look for
// user-level skills, so `/khb …` works from any folder without `khb go` first.
//
// The skill is a router only (see global-skills/khb/SKILL.md): it resolves a hub through
// `khb list --json`, then follows that hub's own skills/<name>/SKILL.md. Rerun this after
// updating khb to refresh the copies. Any other agent: `khb install-skill --path` prints
// the shipped file, to copy wherever that agent reads skills.
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { GLOBAL_SKILL_SOURCE, installInto, skillTargets, type InstallOutcome } from "./lib/global-skill";
import { takeFlag, rejectUnknownFlags } from "./lib/args";
import { paint, paintErr } from "./lib/color";

const USAGE = "khb install-skill [--path] [--force] [--dry-run]";
const argv = process.argv.slice(2);
const wantPath = takeFlag(argv, "--path");
const force = takeFlag(argv, "--force");
const dryRun = takeFlag(argv, "--dry-run");
rejectUnknownFlags(argv, USAGE);
if (argv.length) {
  console.error(`${paintErr.bad("Unexpected argument:")} ${argv.join(" ")}`);
  console.error(`Usage: ${paintErr.cmd(USAGE)}`);
  process.exit(1);
}

// For agents khb does not know: the folder to copy, and nothing else, so it pipes.
if (wantPath) {
  console.log(dirname(GLOBAL_SKILL_SOURCE));
  process.exit(0);
}

const content = readFileSync(GLOBAL_SKILL_SOURCE, "utf8");
const results = skillTargets(homedir()).map((target) => installInto(target, content, { force, dryRun }));

const verb: Record<InstallOutcome, string> = dryRun
  ? { created: "would create", updated: "would update", unchanged: "unchanged", foreign: "skipped" }
  : { created: "created", updated: "updated", unchanged: "unchanged", foreign: "skipped" };
const width = Math.max(...results.map((result) => result.agent.length));

console.log(`${paint.head("Global khb skill")}${dryRun ? paint.dim("  (dry run — nothing written)") : ""}\n`);
for (const result of results) {
  const status = verb[result.outcome].padEnd(12);
  const painted = result.outcome === "foreign" ? paint.warn(status) : result.outcome === "unchanged" ? paint.dim(status) : paint.ok(status);
  console.log(`  ${paint.name(result.agent.padEnd(width))}  ${painted}  ${paint.path(result.file)}`);
}

const foreign = results.filter((result) => result.outcome === "foreign");
if (foreign.length) {
  console.log(
    `\n${paint.warn("Skipped:")} a skill named khb is already there and khb did not write it. ` +
      `Replace it with ${paint.cmd("khb install-skill --force")}.`,
  );
}
console.log(`\nAsk any of them ${paint.cmd("/khb <question>")} from any folder — no ${paint.cmd("khb go")} needed.`);
console.log(`Another agent? Copy ${paint.path(dirname(GLOBAL_SKILL_SOURCE))} into its skills folder.`);
console.log(paint.dim(`Rerun after updating khb to refresh these copies.`));
