// khb new-bundle <name> ["scope line"] — scaffold from .bundle_template + register.
// Template comes from the package; the bundle lands in the hub.
import { existsSync } from "node:fs";
import { BUNDLES, join } from "./lib/util";
import { createBundle, VALID_NAME } from "./lib/scaffold";

const [name, scope = "TODO scope"] = process.argv.slice(2);
if (!name || !VALID_NAME.test(name)) {
  console.error("Usage: khb new-bundle <name> [scope]   (lowercase, digits, hyphens)");
  process.exit(1);
}
if (existsSync(join(BUNDLES, name))) { console.error(`Bundle '${name}' already exists`); process.exit(1); }

createBundle(name, scope);

console.log(`Created bundles/${name}/ and registered it in outer.index.md`);
console.log("Next: set its scope line in outer.index.md, add sources to sources.yaml, run: khb lint");
