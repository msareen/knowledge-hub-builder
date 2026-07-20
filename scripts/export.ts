// bkr export <bundle> [dest] — export a bundle as a standalone, shareable unit.
// Bundles stay lean in the hub (common patterns live at hub root); export injects those
// patterns so the exported folder works alone with any agent.
import { cpSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { HUB, bundleDir, join } from "./lib/util";

const [name, destArg] = process.argv.slice(2);
if (!name) { console.error("Usage: bkr export <bundle> [dest]"); process.exit(1); }

const src = bundleDir(name);
const dest = destArg ?? join(HUB, "export", name);
if (existsSync(dest)) { console.error(`Destination exists: ${dest}`); process.exit(1); }

mkdirSync(dest, { recursive: true });
cpSync(src, join(dest, "bundle"), { recursive: true });

// inject common patterns from the hub's copies (kept current by `bkr upgrade`)
for (const f of ["AGENT.md", "query.md", "lint.md", "ingest.md"]) cpSync(join(HUB, f), join(dest, f));

// standalone router: one-bundle outer index
const scope = (readFileSync(join(HUB, "outer.index.md"), "utf8")
  .split("\n").find((l) => l.includes(`[${name}]`)) ?? "").split("|")[2]?.trim() ?? "";
writeFileSync(join(dest, "outer.index.md"),
  `# outer.index — exported bundle\n\n| Bundle | Scope | Route here when |\n|---|---|---|\n| [${name}](bundle/index.md) | ${scope} | always — single-bundle export |\n`);

writeFileSync(join(dest, "README.md"),
  `# ${name} (exported BKR bundle)\n\nExported: ${new Date().toISOString()}\nOrigin: BKR bundle-of-bundles repo.\n\nStandalone unit: start at AGENT.md → outer.index.md → bundle/index.md.\nNote: refs.md entries pointing at other bundles will not resolve here.\n`);

console.log(`Exported to ${dest} (bundle + AGENT.md, query.md, lint.md, single-bundle router)`);
