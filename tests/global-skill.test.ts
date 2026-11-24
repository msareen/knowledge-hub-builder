// Tests for scripts/lib/global-skill.ts — what `khb install-skill` writes, and what it
// refuses to overwrite. install-skill.ts itself is a top-level script, so only the pure
// helpers are imported; every write goes to a throwaway home directory.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GLOBAL_SKILL_NAME,
  GLOBAL_SKILL_SOURCE,
  OWNERSHIP_MARKER,
  installInto,
  skillTargets,
} from "../scripts/lib/global-skill";
import { MANAGED } from "../scripts/lib/paths";

const homes: string[] = [];
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "khb-skill-"));
  homes.push(home);
  return home;
}
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

const shipped = readFileSync(GLOBAL_SKILL_SOURCE, "utf8");

describe("the shipped skill", () => {
  test("is named khb in its front matter and carries the ownership marker", () => {
    expect(shipped.startsWith("---\nname: khb\n")).toBe(true);
    expect(shipped).toContain(OWNERSHIP_MARKER);
  });

  test("routes to the hub's own skills instead of copying a protocol", () => {
    expect(shipped).toContain("<hub>/AGENTS.md");
    expect(shipped).toContain("<hub>/skills/<name>/SKILL.md");
    expect(shipped).toContain("khb list --json");
    expect(shipped).toContain('khb --hub "<hub>"');
  });

  test("is never copied into a hub", () => {
    expect(MANAGED.some((entry) => entry.startsWith("global-skills"))).toBe(false);
  });
});

describe("skillTargets", () => {
  test("one folder per agent, each ending in the skill's name", () => {
    const home = freshHome();
    const targets = skillTargets(home);
    expect(targets.map((target) => target.agent)).toEqual(["claude", "codex", "gemini"]);
    expect(targets[0].dir).toBe(join(home, ".claude", "skills", GLOBAL_SKILL_NAME));
    expect(targets[1].dir).toBe(join(home, ".agents", "skills", GLOBAL_SKILL_NAME));
    expect(targets[2].dir).toBe(join(home, ".gemini", "skills", GLOBAL_SKILL_NAME));
  });
});

describe("installInto", () => {
  test("creates the folder and file where none exists", () => {
    const [claude] = skillTargets(freshHome());
    const result = installInto(claude, shipped);
    expect(result.outcome).toBe("created");
    expect(readFileSync(result.file, "utf8")).toBe(shipped);
  });

  test("a second install of the same content changes nothing", () => {
    const [claude] = skillTargets(freshHome());
    installInto(claude, shipped);
    expect(installInto(claude, shipped).outcome).toBe("unchanged");
  });

  test("refreshes a copy khb wrote earlier", () => {
    const [claude] = skillTargets(freshHome());
    const older = shipped.replace("# KHB from anywhere", "# KHB from anywhere (old)");
    installInto(claude, older);
    const result = installInto(claude, shipped);
    expect(result.outcome).toBe("updated");
    expect(readFileSync(result.file, "utf8")).toBe(shipped);
  });

  test("keeps someone else's skill named khb unless forced", () => {
    const [claude] = skillTargets(freshHome());
    const file = join(claude.dir, "SKILL.md");
    mkdirSync(claude.dir, { recursive: true });
    writeFileSync(file, "---\nname: khb\ndescription: mine\n---\n");

    expect(installInto(claude, shipped).outcome).toBe("foreign");
    expect(readFileSync(file, "utf8")).toContain("description: mine");

    expect(installInto(claude, shipped, { force: true }).outcome).toBe("updated");
    expect(readFileSync(file, "utf8")).toBe(shipped);
  });

  test("a dry run reports the outcome and writes nothing", () => {
    const [claude] = skillTargets(freshHome());
    const result = installInto(claude, shipped, { dryRun: true });
    expect(result.outcome).toBe("created");
    expect(existsSync(result.file)).toBe(false);
  });
});
