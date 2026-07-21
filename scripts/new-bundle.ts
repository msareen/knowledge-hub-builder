// khb new-bundle <name> ["scope line"] — scaffold from .bundle_template + register.
// Template comes from the package; the bundle lands in the hub.
import { HUB } from "./lib/util";
import { scaffoldBundle, BUNDLE_NAME } from "./lib/scaffold";

const [name, scope = "TODO scope"] = process.argv.slice(2);
if (!name || !BUNDLE_NAME.test(name)) {
  console.error("Usage: khb new-bundle <name> [scope]   (lowercase, digits, hyphens)");
  process.exit(1);
}

try {
  scaffoldBundle(HUB, name, scope);
} catch (err) {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
}

console.log(`Created bundles/${name}/ and registered it in outer.index.md`);
console.log("Next: set its scope line in outer.index.md, add sources to sources.yaml, run: khb lint");
