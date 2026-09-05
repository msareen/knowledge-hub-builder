// pyOneNote: where it is, whether it is there, and — only when asked — putting it there.
//
// Hub-free by construction. `khb init` runs before a hub exists, and importing lib/util
// resolves a hub or exits, so nothing here may reach for it. That is also why the probe
// lives in this file rather than in lib/extract.ts, which is hub-bound through the
// extraction cache: `init` and `ingest` must agree on what "installed" means, so they share
// the one probe instead of each having a version of it.
//
// Installing is opt-in and forgiving, and both halves of that matter. khb does not install
// software on its own initiative — an ingest that finds no pyOneNote pends a row and says
// what to run (skills/ingest/SKILL.md), it does not go and fetch it. `khb init
// --with-onenote` is the other case: the user asking, at the one moment they are setting
// things up. Even then the hub is the deliverable, so every way this can fail — no python,
// no pip, a managed environment, no network — leaves the hub created and prints the manual
// command instead of failing the command.
import { paint } from "./color";

/** The project ships no maintained PyPI release; the archive is what its README documents. */
const PYONENOTE_ZIP = "https://github.com/DissectMalware/pyOneNote/archive/master.zip";

/** The one-line fix printed by `khb ingest`, `khb doctor` and `khb init` alike. */
export const PYONENOTE_INSTALL = `pip install -U ${PYONENOTE_ZIP}`;

/** Probed in this order everywhere — the run, the report and the installer must agree. */
export const PY_BINS = ["python", "python3", "py"];
export const PY_IMPORT = "import pyOneNote.OneDocument";

/**
 * Spawn and keep the exit code and stderr. A tool that fails has a reason, and for the
 * routes that pend a ledger row rather than falling back, that reason is the whole value of
 * the row — "pyOneNote could not parse it" and "python is not installed" have different
 * fixes weeks later.
 *
 * `showOutput` hands stdout straight to the terminal, for the one call that takes long
 * enough to need it: pip downloading an archive should look like progress, not a hang.
 */
export async function runCapture(
  argv: string[],
  { showOutput = false }: { showOutput?: boolean } = {},
): Promise<{ code: number; out: string; err: string }> {
  try {
    const proc = Bun.spawn(argv, { stdout: showOutput ? "inherit" : "pipe", stderr: "pipe", stdin: "ignore" });
    const [out, err] = await Promise.all([
      showOutput ? Promise.resolve("") : new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { code: await proc.exited, out, err };
  } catch {
    return { code: -1, out: "", err: "" }; // not on PATH
  }
}

/** The last thing a failing tool said, which is the part worth repeating. */
export const lastLine = (text: string) => text.trim().split("\n").filter(Boolean).pop() ?? "";

/**
 * Which python — if any — can read a `.one` here.
 *
 * Three answers, because two of them have different fixes: a reader, a python that has no
 * pyOneNote (`pip install …`), or no python at all (where a `pip` command is advice the
 * machine cannot follow). Telling them apart is the difference between a ledger row someone
 * can act on and one they have to re-diagnose, so the probe reads stderr for the import
 * error rather than settling for the exit code. An absent binary makes `Bun.spawn` throw,
 * which `runCapture` reports as -1 — no python is never an exception here, just an answer.
 */
export type PyProbe = { bin: string; without?: undefined } | { bin?: undefined; without: string | null };

export async function probePyOneNote(): Promise<PyProbe> {
  let pythonWithout: string | null = null;
  for (const bin of PY_BINS) {
    const probe = await runCapture([bin, "-c", PY_IMPORT]);
    if (probe.code === 0) return { bin };
    // A python that ran and could not find the module is a python — remember the first one.
    if (probe.code > 0 && !pythonWithout && /No module named|ModuleNotFoundError/.test(probe.err)) pythonWithout = bin;
  }
  return { without: pythonWithout };
}

/** `python -m pip …` rather than a bare `pip`: the module must land in *this* interpreter. */
export function pipArgv(bin: string, userSite = false): string[] {
  return [bin, "-m", "pip", "install", "-U", ...(userSite ? ["--user"] : []), PYONENOTE_ZIP];
}

/**
 * Is this failure one that installing into the user's own site-packages would fix?
 *
 * Two common shapes: a distro python that refuses to be written to at all (PEP 668, Debian
 * and friends), and a system python whose site-packages needs admin. Both are ordinary on a
 * machine nobody set up for python, and `--user` is the answer to both. It is *not* the
 * answer inside a virtualenv, where pip rejects `--user` outright — but a virtualenv is
 * writable, so it never gets here.
 */
export function retryAsUser(stderr: string): boolean {
  // pip quotes its own hint — "Consider using the `--user` option" — so the backticks have
  // to be allowed for, or the one message that names the fix is the one we miss.
  return /externally-managed-environment|Permission denied|Access is denied|EACCES|EPERM|--user[`'"]?\s+option/i.test(
    stderr,
  );
}

export type InstallResult =
  | { status: "already"; bin: string }
  | { status: "installed"; bin: string; userSite: boolean }
  | { status: "no-python" }
  | { status: "no-pip"; bin: string }
  | { status: "failed"; bin: string; reason: string };

/**
 * Install pyOneNote for the python khb would use. Never throws, never exits: the caller is
 * mid-way through creating a hub, and an extractor that could not be set up is not a reason
 * to leave a half-made hub behind.
 */
export async function installPyOneNote(): Promise<InstallResult> {
  const probe = await probePyOneNote();
  if (probe.bin) return { status: "already", bin: probe.bin };

  const bin = probe.without;
  if (!bin) return { status: "no-python" };
  if ((await runCapture([bin, "-m", "pip", "--version"])).code !== 0) return { status: "no-pip", bin };

  console.log(`  installing pyOneNote with ${paint.cmd(`${bin} -m pip`)} …`);
  let attempt = await runCapture(pipArgv(bin), { showOutput: true });
  let userSite = false;
  if (attempt.code !== 0 && retryAsUser(attempt.err)) {
    console.log(`  that python declined a global install — retrying with ${paint.cmd("--user")} …`);
    userSite = true;
    attempt = await runCapture(pipArgv(bin, true), { showOutput: true });
  }
  if (attempt.code !== 0) return { status: "failed", bin, reason: lastLine(attempt.err) || `pip exited ${attempt.code}` };

  // Confirm by import rather than by exit code: pip can succeed into an interpreter whose
  // import path this one does not share, and a "ready" that cannot read a `.one` is worse
  // than an honest failure.
  const after = await probePyOneNote();
  return after.bin ?
      { status: "installed", bin: after.bin, userSite }
    : { status: "failed", bin, reason: "pip reported success but the module still does not import" };
}
