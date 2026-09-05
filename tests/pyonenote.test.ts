import { describe, expect, test } from "bun:test";
import { pipArgv, retryAsUser, lastLine, PY_BINS, PYONENOTE_INSTALL } from "../scripts/lib/pyonenote";

/**
 * The decision parts of `khb init --with-onenote`, which are the parts worth pinning: what
 * gets run, and when a refusal is worth one retry. Actually running pip belongs to a real
 * machine, not a test.
 */
describe("pipArgv", () => {
  test("installs through the interpreter khb probed, not through a bare pip", () => {
    // `pip` on PATH can belong to a different interpreter than `python` — the module has to
    // land in the one that will import it.
    expect(pipArgv("python3")).toEqual([
      "python3",
      "-m",
      "pip",
      "install",
      "-U",
      "https://github.com/DissectMalware/pyOneNote/archive/master.zip",
    ]);
  });

  test("the retry adds --user and nothing else", () => {
    const plain = pipArgv("py");
    const asUser = pipArgv("py", true);
    expect(asUser).toEqual([...plain.slice(0, 5), "--user", plain[5]]);
  });

  test("the documented fix line names the same archive it installs", () => {
    expect(PYONENOTE_INSTALL).toContain(pipArgv("python").at(-1)!);
  });
});

describe("retryAsUser", () => {
  test("a distro python that refuses to be written to is worth one retry", () => {
    expect(retryAsUser("error: externally-managed-environment")).toBe(true);
    expect(retryAsUser("Could not install packages due to an OSError: [Errno 13] Permission denied")).toBe(true);
    expect(retryAsUser("ERROR: Access is denied: 'C:\\\\Python312\\\\Lib\\\\site-packages'")).toBe(true);
    expect(retryAsUser("Consider using the `--user` option or check the permissions.")).toBe(true);
  });

  test("a failure --user cannot fix is not retried", () => {
    expect(retryAsUser("")).toBe(false);
    expect(retryAsUser("ERROR: Could not find a version that satisfies the requirement")).toBe(false);
    expect(retryAsUser("WARNING: Retrying after connection broken by 'NewConnectionError'")).toBe(false);
  });
});

describe("lastLine", () => {
  test("takes the final non-blank line — what a failing tool said last", () => {
    expect(lastLine("Collecting …\nBuilding wheel\nERROR: something specific\n\n")).toBe("ERROR: something specific");
    expect(lastLine("   ")).toBe("");
    expect(lastLine("")).toBe("");
  });
});

describe("PY_BINS", () => {
  test("one probe order, so a run, a report and the installer cannot disagree", () => {
    expect(PY_BINS).toEqual(["python", "python3", "py"]);
  });
});
