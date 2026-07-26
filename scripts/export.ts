// khb export <bundle> [dest] — export a bundle as a standalone, shareable unit.
// Bundles stay lean in the hub (common patterns live at hub root); export injects those
// patterns so the exported folder works alone with any agent.
import { cpSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { HUB, bundleDir, join } from "./lib/util";
import { detail, totalElapsed } from "./lib/log";

const [name, destArg] = process.argv.slice(2);
if (!name) { console.error("Usage: khb export <bundle> [dest]"); process.exit(1); }

const src = bundleDir(name);
const dest = destArg ?? join(HUB, "export", name);
if (existsSync(dest)) { console.error(`Destination exists: ${dest}`); process.exit(1); }

console.log(`khb export → ${name}`);
detail(`from: ${src}`);
detail(`to:   ${dest}`);

mkdirSync(dest, { recursive: true });
detail(`copying bundle/ …`);
cpSync(src, join(dest, "bundle"), { recursive: true });

// Inject the hub's package-owned copies (kept current by `khb upgrade`). AGENTS.md and
// skills/ are canonical; the shims/adapters make them discoverable by Claude and Codex.
for (const item of ["AGENTS.md", "CLAUDE.md", "skills", ".agents/skills", ".claude/skills"]) {
  const target = join(dest, item);
  mkdirSync(join(target, ".."), { recursive: true });
  cpSync(join(HUB, item), target, { recursive: true });
  detail(`copying ${item}`);
}

// standalone router: one-bundle outer index
detail("writing outer.index.md + README.md");
const scope = (readFileSync(join(HUB, "outer.index.md"), "utf8")
  .split("\n").find((l) => l.includes(`[${name}]`)) ?? "").split("|")[2]?.trim() ?? "";
writeFileSync(join(dest, "outer.index.md"),
  `# outer.index — exported bundle\n\n| Bundle | Scope | Route here when |\n|---|---|---|\n| [${name}](bundle/index.md) | ${scope} | always — single-bundle export |\n`);

writeFileSync(join(dest, "README.md"),
  `# ${name} (exported KHB bundle)\n\nExported: ${new Date().toISOString()}\nOrigin: KHB bundle-of-bundles repo.\n\nStandalone unit: start at AGENTS.md → outer.index.md → bundle/index.md.\nWorkflow protocols (query, ingest, lint, …) live in skills/<name>/SKILL.md and are discoverable by Claude and Codex.\nNote: refs.md entries pointing at other bundles will not resolve here.\n`);

console.log(`\nExported to ${dest} in ${totalElapsed()} (bundle + agent contracts, skills, single-bundle router)`);
