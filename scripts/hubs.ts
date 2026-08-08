// khb list / khb go / khb agent / khb forget — the machine-level hub shortcuts.
//
// These are the only commands that work *outside* a hub, and the only ones that read
// ~/.khb/hubs-config.json. They move you between hubs; everything else operates inside
// one. Nothing here touches knowledge — see lib/registry.ts for why the registry is
// disposable by design.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { findHub, markerIn, version } from "./lib/paths";
import { sameLocation, rewritePaths } from "./lib/relocate";
import { clearMoved, staleLocations } from "./lib/upgrade";
import {
  CONFIG,
  agentFor,
  findHubEntry,
  forgetHub,
  isAlive,
  listHubs,
  loadConfig,
  registerHub,
  canonical,
  relocateHub,
  relocationCandidates,
  saveConfig,
  touchHub,
  type HubEntry,
} from "./lib/registry";
import { takeFlag } from "./lib/args";
import { detail, section, totalElapsed } from "./lib/log";

const cmd = process.env.KHB_SUBCOMMAND ?? "go";
const argv = process.argv.slice(2);

/** Take `--name value`, removing both. */
function takeOpt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined) {
    console.error(`${name} needs a value`);
    process.exit(1);
  }
  args.splice(i, 2);
  return v;
}

const ago = (iso?: string): string => {
  if (!iso) return "";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days)) return "";
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`;
};

function printList(hubs: HubEntry[]): void {
  const w = Math.max(4, ...hubs.map((h) => h.name.length));
  hubs.forEach((h, i) => {
    const live = isAlive(h);
    const tag = live ? String(i + 1).padStart(2) : " x";
    const note = live ? ago(h.lastUsed) : "MISSING";
    console.log(`  ${tag}  ${h.name.padEnd(w)}  ${h.description}`);
    console.log(`      ${" ".repeat(w)}  ${h.path}${note ? `  (${note})` : ""}`);
  });
}

/**
 * What a cold `khb` prints when there is nothing to open and no terminal to ask on.
 * The interactive path is `wizard()`; this is its non-TTY twin.
 */
function noHubs(): never {
  console.log(`No hubs registered on this machine (${CONFIG}).\n`);
  console.log(`Create one:              khb init <dir>`);
  console.log(`Or register an existing:  khb go <dir>       (any path holding a khb.json)`);
  console.log(`\nRun 'khb' on a terminal and it walks you through the first one.`);
  process.exit(0);
}

/**
 * Ask on the terminal. Returns undefined when there is no terminal to ask on — a piped or
 * scripted khb must print and stop rather than block forever on a prompt nobody sees.
 *
 * Input is read key by key rather than through prompt(), for one reason: Esc. A prompt you
 * can only escape by typing nothing and pressing Enter is a prompt you have to think about,
 * and Enter already means "take the default" two questions earlier in the wizard. Esc means
 * the same thing at every prompt in this file — stop, do nothing — so it is handled here,
 * once, by ending the command. Ctrl-C likewise: raw mode suppresses the signal, so the
 * prompt would otherwise be unquittable.
 */
function ask(question: string): string | undefined {
  if (!process.stdin.isTTY) return undefined;
  try {
    return readKeys(question);
  } catch {
    // A terminal that will not go into raw mode still answers a line at a time. prompt()
    // returns null for a bare Enter as well as for a cancel; both are "the user typed
    // nothing", which is an answer here — only a missing terminal is "cannot ask".
    try {
      return prompt(question) ?? "";
    } catch {
      return undefined;
    }
  }
}

/**
 * One line of input, read a keypress at a time. Throws if the terminal has no raw mode,
 * which is `ask`'s cue to fall back; exits on Esc and Ctrl-C, restoring the terminal first
 * since process.exit runs no `finally`.
 */
function readKeys(question: string): string {
  const stdin = process.stdin;
  // Something for Atomics.wait to block on. It is never notified — the wait exists only to
  // hand the CPU back between reads, which is the one way to sleep without going async.
  const idle = new Int32Array(new SharedArrayBuffer(4));
  stdin.setRawMode(true);
  const stop = (code: number, text: string): never => {
    stdin.setRawMode(false);
    process.stdout.write(text);
    process.exit(code);
  };

  process.stdout.write(question);
  const buf = Buffer.alloc(64);
  const utf8 = new StringDecoder("utf8");
  let line = "";
  let read = false;
  try {
    for (;;) {
      let n = 0;
      try {
        n = readSync(0, buf, 0, buf.length, null);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        // Nothing typed yet on a non-blocking stdin. Wait a moment before asking again —
        // a bare `continue` here is a spin loop on one core for as long as the prompt is up.
        if (code === "EAGAIN") {
          Atomics.wait(idle, 0, 0, 15);
          continue;
        }
        if (code !== "EOF") throw e;
      }
      // End of input before a single key: this terminal cannot be read this way — some
      // consoles report EOF rather than blocking. Say so, so ask() falls back to a line
      // reader. Answering "" here instead would be the worse bug by far: silent empty
      // answers to every question, and a wizard that runs itself on defaults.
      if (!n && !read) throw new Error("stdin: no keys to read");
      if (!n) break; // ended mid-answer: take what was typed, as a bare Enter would
      read = true;

      // A lone Esc is a cancel. Esc with bytes behind it is an arrow or function key —
      // terminals deliver those as one read — and has no meaning at a prompt.
      if (buf[0] === 0x1b) {
        if (n === 1) stop(0, "\ncancelled\n");
        continue;
      }

      // Decoded as text, not bytes: paths and descriptions are typed here, and a name with
      // an accent in it must not arrive as two mangled characters. The decoder holds any
      // trailing half-character back until the read that completes it — a pasted line can
      // land across two buffers.
      for (const ch of utf8.write(buf.subarray(0, n))) {
        const c = ch.codePointAt(0) ?? 0;
        if (c === 0x0d || c === 0x0a) return finish(stdin, line); // Enter
        if (c === 0x03) stop(130, "^C\n"); // Ctrl-C, which raw mode swallowed
        if (c === 0x04 && !line) stop(0, "\ncancelled\n"); // Ctrl-D on an empty line
        if (c === 0x7f || c === 0x08) {
          // Backspace. Erase on screen too — raw mode echoes nothing on its own.
          if (line) {
            line = line.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (c < 0x20) continue; // every other control key: ignore
        line += ch;
        process.stdout.write(ch);
      }
    }
  } finally {
    stdin.setRawMode(false);
  }
  return finish(stdin, line);
}

/** Leave the terminal as a line-based prompt would have: cooked mode, cursor on a new line. */
function finish(stdin: typeof process.stdin, line: string): string {
  stdin.setRawMode(false);
  process.stdout.write("\n");
  return line;
}

/**
 * Hand the terminal to the configured agent, running in the hub. This is the payoff of
 * the registry: `khb` from a cold shell anywhere ends with an agent open on the right
 * folder. khb cannot change the caller's shell directory — no child process can — so the
 * `cd` line is printed for the human and the hub is passed to the agent as its cwd.
 */
function launch(hub: HubEntry, agentName?: string, noAgent = false): never {
  touchHub(hub.path);
  console.log(`\n${hub.name} — ${hub.path}`);
  console.log(`  cd ${/\s/.test(hub.path) ? JSON.stringify(hub.path) : hub.path}`);

  const cfg = loadConfig();
  const agent = noAgent ? undefined : agentFor(cfg, agentName);
  if (!agent) {
    if (!noAgent) console.log(`\nNo default agent set — khb agent <claude|codex> to set one.`);
    process.exit(0);
  }

  console.log(`  launching ${agent.name}…\n`);
  // shell:true on Windows so PATH shims (claude.cmd, codex.cmd) resolve; stdio inherited
  // so the agent owns the terminal from here.
  const r = spawnSync(agent.spec.command, agent.spec.args ?? [], {
    cwd: hub.path,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.error) {
    console.error(`\nCould not launch ${agent.name} (${agent.spec.command}): ${r.error.message}`);
    console.error(`Fix the command:  khb agent ${agent.name} --command <exe>`);
    process.exit(1);
  }
  process.exit(r.status ?? 0);
}

// ------------------------------------------------------------------- first-run wizard
//
// A bare `khb` on a machine with no hubs used to print three lines of guidance and stop,
// which asks someone who has just installed the tool to go and read about it before they
// can do anything. Since we are already on a terminal and already know the one thing they
// need — that there is no hub yet — walk them into one instead.
//
// It only ever asks what `khb init` takes as flags, and calls the same createHub(): a hub
// born here is byte-identical to one made by hand. Every question has a default, so
// holding Enter through the whole thing produces a working hub.

/** Is this command actually runnable? Probed with --version, which no agent acts on. */
function onPath(command: string): boolean {
  try {
    const r = spawnSync(command, ["--version"], {
      stdio: "ignore",
      shell: process.platform === "win32",
      timeout: 5000,
    });
    return !r.error && r.status === 0;
  } catch {
    return false;
  }
}

/** Ask with a default that Enter accepts. */
function askWith(question: string, fallback: string): string {
  const a = ask(`${question}${fallback ? `  [${fallback}]` : ""} `);
  const t = (a ?? "").trim();
  return t || fallback;
}

async function wizard(): Promise<never> {
  const cfg = loadConfig();
  console.log(`khb ${version()} — Knowledge Hub Builder\n`);
  console.log(`No hubs on this machine yet. Let's set one up.\n`);
  console.log(`A hub is a folder of plain markdown that holds your knowledge. khb does the`);
  console.log(`mechanical half — pulling documents in, extracting text, checking structure —`);
  console.log(`and your coding agent does the thinking half. Press Enter to take any default.\n`);

  // 1. Where. Default under the home directory rather than cwd: a hub is long-lived, and
  //    the folder someone happens to be standing in when they first run khb rarely is.
  const suggested = join(homedir(), "knowledge");
  const dir = resolve(askWith(`1/5  Where should the hub live?`, suggested));

  if (markerIn(dir)) {
    // Already a hub — the machine simply had not heard of it. Adopt, do not re-create.
    const entry = registerHub(dir);
    console.log(`\n${dir} is already a hub — added it to the list as "${entry.name}".`);
    console.log(`Open it:  khb`);
    process.exit(0);
  }
  if (existsSync(dir) && readdirSync(dir).length) {
    const ok = askWith(`     ${dir} is not empty. Put the hub there anyway? [y/N]`, "n");
    if (!/^y/i.test(ok)) {
      console.log(`\nStopped. Nothing was created. Re-run 'khb' to start again.`);
      process.exit(0);
    }
  }

  // 2-3. Identity. Both land in the hub's own khb.json, so they travel with the folder.
  const name = askWith(`2/5  What should it be called?`, basename(dir) || "knowledge");
  const description = askWith(`3/5  One line describing it (optional)?`, "");

  // 4. The agent. Detected rather than asked blind — being offered a tool you do not have
  //    installed is a worse first question than being told which one was found.
  const found = ["claude", "codex"].filter(onPath);
  console.log(`\n4/5  Which agent should 'khb' open the hub with?`);
  for (const [i, k] of Object.keys(cfg.agents).entries())
    console.log(`       ${i + 1}) ${k}${found.includes(k) ? "  (found on PATH)" : ""}`);
  console.log(`       or type any command, or 'none' to just print the path`);
  const agentAnswer = askWith(`     Choice?`, found[0] ?? "none");
  const keys = Object.keys(cfg.agents);
  const picked =
    /^\d+$/.test(agentAnswer) && keys[Number(agentAnswer) - 1] ? keys[Number(agentAnswer) - 1] : agentAnswer;

  // 5. A first bundle, because an empty hub has nowhere to put anything and the next
  //    question a new user hits is where material goes. Skippable with '-'.
  console.log(`\n5/5  A bundle is a unit of ownership — you, a team, a client, a project.`);
  const bundle = askWith(`     Name your first one ('-' to skip)?`, "personal");
  const scope =
    bundle === "-" ? "" : askWith(`     One line on what it covers?`, "TODO scope");

  // ---- act ----
  const { createHub } = await import("./lib/create");
  const { hub, entry } = createHub(dir, { name, description });
  console.log(`\nCreated ${hub}`);

  // scaffold.ts resolves the hub through util.ts at import time, so the hub must be
  // announced before it is loaded — hence the import inside the branch, not at the top.
  let madeBundle = false;
  if (bundle !== "-") {
    process.env.KHB_HUB = hub;
    const { createBundle, VALID_NAME } = await import("./lib/scaffold");
    if (VALID_NAME.test(bundle)) {
      createBundle(bundle, scope);
      console.log(`  bundles/${bundle}/ — registered in outer.index.md`);
      madeBundle = true;
    } else {
      console.log(`  skipped the bundle: '${bundle}' is not a valid name (lowercase, digits, hyphens)`);
      console.log(`  add one later:  khb new-bundle <name> "<scope>"`);
    }
  }

  if (picked === "none" || !picked) {
    cfg.defaultAgent = "";
  } else {
    cfg.agents[picked] = cfg.agents[picked] ?? { command: picked, args: [] };
    cfg.defaultAgent = picked;
  }
  saveConfig(cfg);
  console.log(`  registered as "${entry.name}", agent: ${cfg.defaultAgent || "none"}`);

  console.log(`\nFrom any terminal, 'khb' comes back here${cfg.defaultAgent ? ` and starts ${cfg.defaultAgent}` : ""}.`);
  if (madeBundle)
    console.log(`Next: add sources to bundles/${bundle}/sources.yaml, then 'khb ingest ${bundle}'.`);

  const go = askWith(`\nOpen it now?`, "y");
  if (!/^y/i.test(go)) process.exit(0);
  launch({ ...entry, path: hub });
}

// ---------------------------------------------------------------------------- list

if (cmd === "list") {
  const asJson = takeFlag(argv, "--json");
  const hubs = listHubs();
  if (asJson) {
    console.log(JSON.stringify({ config: CONFIG, ...loadConfig(), hubs }, null, 2));
    process.exit(0);
  }
  if (!hubs.length) noHubs();

  console.log(`Hubs on this machine  (${CONFIG})\n`);
  printList(hubs);
  const cfg = loadConfig();
  const agent = agentFor(cfg);
  console.log(`\nDefault agent: ${agent ? `${agent.name} (${agent.spec.command})` : "none"}`);
  console.log(`Open one:      khb go ${hubs[0].name}    |    khb go 1    |    khb`);
  process.exit(0);
}

// ---------------------------------------------------------------------- update-path
//
// Repair after a hub was moved on disk. Two things break, and both are fixed here: the
// machine's shortcut list still points at the old folder, and any absolute path inside the
// hub that named the old location is now a dangling reference — `sources.yaml` entries,
// `source:` headers in `raw/`, `log.md` rows, `resource:` front matter.
//
// Named for what it moves rather than the shorter `update`, which sat one letter from
// `upgrade` and meant something entirely different.

if (cmd === "update-path") {
  const dryRun = takeFlag(argv, "--dry-run");
  const fromOpt = takeOpt(argv, "--from");
  const [dest] = argv;

  // The hub is wherever it is now: the path given, else the hub containing cwd.
  const newPath = canonical(dest ?? findHub() ?? process.cwd());
  if (!markerIn(newPath)) {
    console.error(`Not a KHB hub: ${newPath}`);
    console.error(`Run 'khb update-path' from inside the moved hub, or name it: khb update-path <new-path>`);
    process.exit(1);
  }

  // Where it used to be. Given explicitly, or inferred from the registry entry that now
  // points at nothing — proof only, since rewriting paths against a wrong guess would
  // corrupt real references. Every spelling seen along the way is kept: the string the
  // registry stored is the one the hub's files are most likely to contain.
  const oldSpellings: string[] = fromOpt ? [fromOpt, resolve(fromOpt)] : [];
  // canonical(), not resolve(): the safety checks below compare this against newPath, and
  // two spellings of one directory must not read as two different places.
  let oldPath = fromOpt ? canonical(fromOpt) : undefined;

  // What the hub says about itself comes first — better evidence than anything the machine
  // registry holds, since the marker moved with the folder and the registry only ever
  // described it from outside. A hub moved more than once before anyone repaired it lists
  // every stale home; all of them are rewritten in this one pass.
  const recorded = staleLocations(newPath);
  oldSpellings.push(...recorded);
  // The most recent stale home is the one to report and to repoint the registry from; the
  // earlier ones still get rewritten, they just are not the move anyone is describing.
  if (!oldPath && recorded.length) oldPath = canonical(recorded[recorded.length - 1]);

  if (!oldPath) {
    const { certain, likely } = relocationCandidates(newPath);
    if (certain.length === 1) {
      oldPath = resolve(certain[0].path);
      oldSpellings.push(certain[0].path);
    } else if (certain.length > 1) {
      console.error(`Several registered hubs share this hub's identity — name the old path:`);
      for (const h of certain) console.error(`  khb update-path ${newPath} --from ${h.path}`);
      process.exit(1);
    } else if (likely.length === 1) {
      // A name match is circumstantial — hubs registered before khb recorded an identity
      // stamp have nothing better. Confirm it rather than rewrite files on a hunch.
      const guess = likely[0];
      const yes = ask(`Was this hub at ${guess.path} (registered as "${guess.name}")? [y/N] `);
      if (yes === undefined) {
        console.error(`This hub carries no identity stamp, so the old path cannot be proven.`);
        console.error(`Likely: ${guess.path}`);
        console.error(`Confirm it:  khb update-path --from ${guess.path}`);
        process.exit(1);
      }
      if (!/^y/i.test(yes.trim())) process.exit(0);
      oldPath = resolve(guess.path);
      oldSpellings.push(guess.path);
    } else if (likely.length > 1) {
      console.error(`No registered hub matches this one's identity, but these went missing:`);
      for (const h of likely) console.error(`  ${h.name}  ${h.path}`);
      console.error(`\nIf one of those is this hub, say so:  khb update-path --from <old-path>`);
      process.exit(1);
    }
  }

  if (!oldPath) {
    // Nothing broken to repair — but the move may predate the registry, so make sure the
    // hub is at least on the list before reporting there was nothing to do.
    const entry = registerHub(newPath);
    // Leave the hub knowing where it is, so the *next* move needs no argument at all.
    clearMoved(newPath);
    console.log(`Nothing to repair: the hub's khb.json already records this location, and`);
    console.log(`no registered hub is missing from disk.`);
    console.log(`${entry.name} is registered at ${entry.path}.`);
    console.log(`\nIf you know the old path, pass it:  khb update-path --from <old-path>`);
    process.exit(0);
  }

  if (sameLocation(oldPath, newPath)) {
    console.error(`Old and new paths are the same directory:`);
    console.error(`  ${newPath}`);
    console.error(`There is no move to repair. Name the real old path:  khb update-path --from <old-path>`);
    process.exit(1);
  }

  // State the whole plan before doing any of it — same contract as ingest: a command that
  // rewrites files says what it is about to rewrite, and where, before the first write.
  console.log(`khb update-path${dryRun ? " (dry run)" : ""}`);
  detail(`from:     ${oldPath}`);
  // Earlier homes, when the hub moved more than once before anyone repaired it. Spellings
  // of `oldPath` itself are not listed — they are the same directory under another name.
  for (const p of [...new Set(oldSpellings)].filter((p) => !sameLocation(canonical(p), oldPath!)))
    detail(`  also:   ${p}`);
  detail(`to:       ${newPath}`);
  detail(`mode:     ${dryRun ? "report only, nothing written" : "rewrite in place"}`);

  // Search for every string that named the old location, not just its canonical form:
  // files written before khb canonicalized paths may hold a short-name or symlinked
  // spelling of the same directory, and those references are just as broken.
  const froms = [...new Set([oldPath, ...oldSpellings])].filter(Boolean);

  section(`scanning ${newPath} …`);
  const { scanned, hits, failed } = rewritePaths(newPath, froms, newPath, {
    dryRun,
    onStart: (n) => detail(`${n} file(s) to check (skipping .git/, node_modules/, inbox/)`),
  });

  const total = hits.reduce((n, h) => n + h.count, 0);
  if (!hits.length) {
    detail(`no old-path references in ${scanned} text file(s) — nothing inside the hub to fix`);
  } else {
    detail(`${total} reference(s) in ${hits.length} of ${scanned} text file(s):`);
    for (const h of hits) console.log(`    ${String(h.count).padStart(3)}  ${h.file}`);
  }
  for (const f of failed) console.error(`    could not write ${f.file}: ${f.reason}`);

  if (dryRun) {
    console.log(`\ndone in ${totalElapsed()} — nothing was written.`);
    console.log(`Re-run without --dry-run to apply.`);
    process.exit(0);
  }

  const entry = relocateHub(oldPath, newPath);
  // The hub's own record of the move is the backlog, so it is cleared by the thing that
  // works the backlog off — otherwise every later command would go on announcing a move
  // that has already been repaired. Not on --dry-run: nothing was repaired there.
  if (!failed.length) clearMoved(newPath);
  console.log(`\ndone in ${totalElapsed()}`);
  console.log(`  ${total} reference(s) rewritten in ${hits.length} file(s)`);
  console.log(`  registry: ${entry.name} now points at ${entry.path}`);
  console.log(`  khb.json: path now ${newPath}`);
  console.log(`Next: khb lint`);
  process.exit(failed.length ? 1 : 0);
}

// --------------------------------------------------------------------------- forget

if (cmd === "forget") {
  const [what] = argv;
  if (!what) {
    console.error(`Usage: khb forget <name|path>`);
    console.error(`Removes the shortcut only — the hub folder is left untouched.`);
    process.exit(1);
  }
  const gone = forgetHub(findHubEntry(what)?.path ?? what);
  if (!gone) {
    console.error(`Not registered: ${what}`);
    process.exit(1);
  }
  console.log(`Forgot ${gone.name} (${gone.path}). The folder itself is untouched.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------- agent

if (cmd === "agent") {
  const command = takeOpt(argv, "--command");
  const argsOpt = takeOpt(argv, "--args");
  const [name] = argv;
  const cfg = loadConfig();

  if (!name && !command) {
    const cur = agentFor(cfg);
    console.log(`Default agent: ${cur ? `${cur.name} (${cur.spec.command})` : "none"}`);
    console.log(`\nKnown:`);
    for (const [k, v] of Object.entries(cfg.agents))
      console.log(`  ${k === cfg.defaultAgent ? "*" : " "} ${k.padEnd(8)} ${[v.command, ...(v.args ?? [])].join(" ")}`);
    console.log(`\nSet:   khb agent codex`);
    console.log(`       khb agent claude --command claude --args "--continue"`);
    console.log(`Off:   khb agent none        (khb go just prints the path)`);
    process.exit(0);
  }

  if (name === "none") {
    cfg.defaultAgent = "";
    saveConfig(cfg);
    console.log(`Default agent cleared — khb go will print the hub path and stop.`);
    process.exit(0);
  }

  const key = name ?? cfg.defaultAgent;
  const existing = cfg.agents[key];
  cfg.agents[key] = {
    command: command ?? existing?.command ?? key,
    args: argsOpt !== undefined ? argsOpt.split(" ").filter(Boolean) : (existing?.args ?? []),
  };
  cfg.defaultAgent = key;
  saveConfig(cfg);
  const spec = cfg.agents[key];
  console.log(`Default agent: ${key} — ${[spec.command, ...(spec.args ?? [])].join(" ")}`);
  console.log(`Saved to ${CONFIG}`);
  process.exit(0);
}

// ------------------------------------------------------------------------------- go

const wantPath = takeFlag(argv, "--path");
const noAgent = takeFlag(argv, "--no-agent") || wantPath;
const agentName = takeOpt(argv, "--agent");
const [what] = argv;

// Named target: resolve through the registry, then fall back to any path that is a hub —
// `khb go ../other-hub` should work whether or not it has been seen before.
if (what) {
  let entry = findHubEntry(what);
  if (!entry && existsSync(resolve(what)) && markerIn(resolve(what))) entry = registerHub(resolve(what));
  if (!entry) {
    console.error(`No such hub: ${what}`);
    console.error(`Registered hubs:  khb list`);
    process.exit(1);
  }
  if (!isAlive(entry)) {
    console.error(`${entry.name} is registered at ${entry.path}, but that is no longer a hub.`);
    console.error(`Drop the shortcut:  khb forget ${entry.name}`);
    process.exit(1);
  }
  if (wantPath) {
    console.log(entry.path);
    process.exit(0);
  }
  launch(entry, agentName, noAgent);
}

const hubs = listHubs().filter(isAlive);
// Nothing to open. On a terminal that is not an error, it is the first run — walk them
// into a hub. `--path` is a script asking for a path, so it never starts a conversation.
if (!hubs.length) {
  if (wantPath || !process.stdin.isTTY) noHubs();
  await wizard();
}

// Exactly one hub: there is nothing to choose, so confirm rather than list. Enter accepts.
if (hubs.length === 1) {
  const only = hubs[0];
  if (wantPath) {
    console.log(only.path);
    process.exit(0);
  }
  const cfg = loadConfig();
  const agent = noAgent ? undefined : agentFor(cfg);
  const answer = ask(
    `Open ${only.name} (${only.path})${agent ? ` with ${agent.name}` : ""}? [Y/n] `,
  );
  if (answer === undefined) {
    // No terminal to ask on — say where it is and how to go there, then stop.
    console.log(`One hub registered:\n`);
    printList([only]);
    console.log(`\nOpen it:  khb go ${only.name}`);
    process.exit(0);
  }
  if (/^n/i.test(answer.trim())) process.exit(0);
  launch(only, agentName, noAgent);
}

// More than one: show the list and take a pick.
console.log(`Hubs on this machine  (${CONFIG})\n`);
printList(hubs);

if (wantPath) process.exit(0); // ambiguous: a script must name the hub it means

const answer = ask(`\nOpen which? [1-${hubs.length}, Esc to cancel] `);
if (answer === undefined) {
  console.log(`\nOpen one:  khb go ${hubs[0].name}    |    khb go 1`);
  process.exit(0);
}
const picked = answer.trim();
if (!picked) process.exit(0);
const chosen = findHubEntry(picked);
if (!chosen || !isAlive(chosen)) {
  console.error(`Not a listed hub: ${picked}`);
  process.exit(1);
}
launch(chosen, agentName, noAgent);
