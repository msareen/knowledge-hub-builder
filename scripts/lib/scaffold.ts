// Bundle creation and lookup, shared by `khb new-bundle` and `khb ingest`.
// One implementation so every bundle is born the same way: same template, same {{name}}
// substitution, same outer.index.md row — and nothing ever conjures one implicitly.
import { cpSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { HUB, BUNDLES, TEMPLATE, join } from "./util";

// The landing bundle: where a bare `khb ingest` goes in a hub with nothing to choose between
// — conjured when the hub has no bundles at all, reused when it is the only one. With a real
// bundle present the destination is a choice and the user makes it, so nothing is auto-created.
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

/** Names of the bundles that exist in this hub, alphabetically. */
export function listBundles(): string[] {
  if (!existsSync(BUNDLES)) return [];
  return readdirSync(BUNDLES)
    .filter((n) => statSync(join(BUNDLES, n)).isDirectory())
    .sort();
}

/**
 * Resolve the bundle to ingest into. A name the user gave must already exist — which bundle
 * owns material is their decision, so an unresolvable name is a typo, not a scaffold request.
 * The one exception is `default` in a hub with no bundles: the first ingest anywhere must
 * still have somewhere to land, and there is no choice to put to the user yet.
 */
export function bundleForIngest(name: string): string {
  const dir = join(BUNDLES, name);
  if (existsSync(dir)) return dir;
  const have = listBundles();
  if (name === DEFAULT_BUNDLE && !have.length) {
    // The scope line lands in outer.index.md, where every agent reads it — so it must not
    // read as an instruction to reorganize the hub. Splitting `default` into real bundles is
    // the user's call, exactly like any other bundle decision.
    createBundle(DEFAULT_BUNDLE, "Unsorted material — where a first ingest lands before any bundle exists; moves out when you say which bundle owns it");
    console.log(`Created bundles/${DEFAULT_BUNDLE}/ — this hub had no bundles to land in.`);
    return dir;
  }
  console.error(`No such bundle: ${name}`);
  if (have.length) console.error(`This hub has: ${have.join(", ")}`);
  console.error(`Create it:   khb new-bundle ${name} "<scope>"`);
  process.exit(1);
}
