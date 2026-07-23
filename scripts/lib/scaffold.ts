// Bundle creation, shared by `khb new-bundle` and by ingest's default-bundle fallback.
// One implementation so a bundle born from a bare `khb ingest` is indistinguishable from
// one the user named: same template, same {{name}} substitution, same outer.index.md row.
import { cpSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { HUB, BUNDLES, TEMPLATE, join } from "./util";

export const DEFAULT_BUNDLE = "default";

export const VALID_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** Scaffold bundles/<name>/ from the template and register it in outer.index.md. */
export function createBundle(name: string, scope: string): string {
  const dest = join(BUNDLES, name);
  cpSync(TEMPLATE, dest, { recursive: true });

  // fill {{name}} placeholders
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  for (const f of walk(dest)) {
    const c = readFileSync(f, "utf8");
    if (c.includes("{{name}}")) writeFileSync(f, c.replaceAll("{{name}}", name));
  }

  // register in outer.index.md (append to first table)
  const outerPath = join(HUB, "outer.index.md");
  const lines = readFileSync(outerPath, "utf8").split("\n");
  const row = `| [${name}](bundles/${name}/index.md) | ${scope} | TODO |`;
  let lastTableRow = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].startsWith("|")) lastTableRow = i;
  lines.splice(lastTableRow + 1, 0, row);
  writeFileSync(outerPath, lines.join("\n"));

  return dest;
}

/**
 * Resolve the bundle to ingest into, creating `default` if that is the target and it does
 * not exist yet. A hub with no bundles must still have somewhere for bytes to land — the
 * alternative is refusing the first ingest anyone ever runs. Only `default` is ever
 * conjured this way: a misspelled explicit name is a mistake, not a request to scaffold.
 */
export function bundleForIngest(name: string): string {
  const dir = join(BUNDLES, name);
  if (existsSync(dir)) return dir;
  if (name !== DEFAULT_BUNDLE) {
    console.error(`No such bundle: ${name}`);
    console.error(`Create it:   khb new-bundle ${name} "<scope>"`);
    process.exit(1);
  }
  createBundle(DEFAULT_BUNDLE, "Unsorted material — split into real bundles as it earns them");
  console.log(`Created bundles/${DEFAULT_BUNDLE}/ — the landing bundle for unrouted material.`);
  return dir;
}
