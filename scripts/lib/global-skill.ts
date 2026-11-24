// The one global skill khb ships: `global-skills/khb/SKILL.md`, a router that lets an agent
// started in any folder find a hub and hand over to that hub's own skills. It carries no
// workflow — the protocols stay in each hub's `skills/`, at that hub's version — so it is
// deliberately NOT part of MANAGED and never copied into a hub.
//
// `khb install-skill` copies it into each agent's user-level skills folder. Everything that
// decides what to write lives here, free of argv and console, so it can be tested.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PKG } from "./paths";

export const GLOBAL_SKILL_NAME = "khb";

/** The shipped copy, inside the installed package. */
export const GLOBAL_SKILL_SOURCE = join(PKG, "global-skills", GLOBAL_SKILL_NAME, "SKILL.md");

/**
 * Present in every copy khb writes. A file at the destination without it belongs to
 * someone else — a skill of their own that happens to be called `khb` — and is left alone
 * unless they say `--force`.
 */
export const OWNERSHIP_MARKER = "khb-global-skill:";

/** An agent runtime with a user-level skills folder that khb installs into. */
export type SkillTarget = { agent: string; dir: string };

/**
 * Where each agent looks for user-level skills, relative to the home directory. Codex reads
 * `~/.agents/skills` (the same `.agents/skills` layout hubs use for it at project level).
 * Gemini CLI reads `~/.gemini/skills` and, with priority, the `~/.agents/skills` alias —
 * so it finds the copy either way; its own folder is written too so it does not depend
 * on the alias. Any other agent: copy GLOBAL_SKILL_SOURCE where that agent looks.
 */
export function skillTargets(home: string): SkillTarget[] {
  return [
    { agent: "claude", dir: join(home, ".claude", "skills", GLOBAL_SKILL_NAME) },
    { agent: "codex", dir: join(home, ".agents", "skills", GLOBAL_SKILL_NAME) },
    { agent: "gemini", dir: join(home, ".gemini", "skills", GLOBAL_SKILL_NAME) },
  ];
}

/** What installing into one target did, or would do under `--dry-run`. */
export type InstallOutcome = "created" | "updated" | "unchanged" | "foreign";

export type InstallResult = SkillTarget & { file: string; outcome: InstallOutcome };

/**
 * Decide, and unless `dryRun` perform, the install into one target. A file that already
 * matches is left untouched; one khb wrote earlier is refreshed; one khb did not write is
 * reported as `foreign` and kept, unless `force`.
 */
export function installInto(
  target: SkillTarget,
  content: string,
  options: { force?: boolean; dryRun?: boolean } = {},
): InstallResult {
  const file = join(target.dir, "SKILL.md");
  let outcome: InstallOutcome;
  if (!existsSync(file)) {
    outcome = "created";
  } else {
    const existing = readFileSync(file, "utf8");
    if (existing === content) outcome = "unchanged";
    else if (existing.includes(OWNERSHIP_MARKER) || options.force) outcome = "updated";
    else outcome = "foreign";
  }
  if (!options.dryRun && (outcome === "created" || outcome === "updated")) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return { ...target, file, outcome };
}
