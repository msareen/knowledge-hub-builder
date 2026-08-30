// A throwaway bundle directory for tests that genuinely need the filesystem (ledger's
// identify()/isFresh() consult existsSync for real, so faking it would test the fake, not
// the predicate). Lives outside the repo tree under the OS temp dir, so it is never touched
// by relocate.ts's walk of the real hub.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function makeTmpBundle(): { dir: string; rawDir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "khb-test-"));
  const rawDir = join(dir, "raw");
  mkdirSync(rawDir, { recursive: true });
  return { dir, rawDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Write a raw/ file so existsSync(bundleDir/raw) checks in ledger.ts see it. */
export function writeRawFile(bundleDir: string, relPath: string, content = "content"): string {
  const full = join(bundleDir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  return relPath;
}
