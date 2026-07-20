// bun scripts/new-bundle.ts <name> ["scope line"] — scaffold from _template + register
import { cpSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { ROOT, BUNDLES, TEMPLATE, join } from "./lib/util";

const [name, scope = "TODO scope"] = process.argv.slice(2);
if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error("Usage: bun run new-bundle <name> [scope]   (lowercase, digits, hyphens)");
  process.exit(1);
}
const dest = join(BUNDLES, name);
if (existsSync(dest)) { console.error(`Bundle '${name}' already exists`); process.exit(1); }

cpSync(TEMPLATE, dest, { recursive: true });

// fill {{name}} placeholders
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
for (const f of walk(dest)) {
  const c = readFileSync(f, "utf8");
  if (c.includes("{{name}}")) writeFileSync(f, c.replaceAll("{{name}}", name));
}

// register in outer.index.md (append to first table)
const outerPath = join(ROOT, "outer.index.md");
const lines = readFileSync(outerPath, "utf8").split("\n");
const row = `| [${name}](bundles/${name}/index.md) | ${scope} | TODO |`;
let lastTableRow = -1;
for (let i = 0; i < lines.length; i++) if (lines[i].startsWith("|")) lastTableRow = i;
lines.splice(lastTableRow + 1, 0, row);
writeFileSync(outerPath, lines.join("\n"));

console.log(`Created bundles/${name}/ and registered it in outer.index.md`);
console.log("Next: set its scope line in outer.index.md, add sources to sources.yaml, run: bun run lint");
