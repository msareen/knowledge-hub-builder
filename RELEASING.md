# Releasing

Maintainer-only. Not shipped into hubs — unlike `AGENTS.md`/`CLAUDE.md`/`SPEC.md`, this file
is not in `package.json`'s `files`, so `khb upgrade` never touches it and users never see it.

## Not every bump is a release

Two different things use the same first three steps, and conflating them is how contract-doc
changes go nowhere:

- **Internal bump — steps 1–3, then stop.** No tag, no GitHub release, no `npm publish`.
  Several can stack up between releases; the next release publishes whatever version is
  current by then.
- **Release — steps 1–6.** Ends with the package on npm.

**A change to any package-owned file needs an internal bump at minimum** — `AGENTS.md`,
`CLAUDE.md`, `SPEC.md`, `skills/`, `.claude/skills/`, `.agents/skills/`: everything in
`MANAGED` (`scripts/lib/paths.ts`). The reason is that the automatic refresh is gated on the
*version*, not on the content:

```ts
// scripts/cli.ts — runs before every in-hub command
if (hubVersion(hub) !== version() || markerIn(hub) !== MARKER) { … }
```

Equal versions and a correctly-named marker and the whole block is skipped, silently. So a
rewritten skill shipped under an unchanged version reaches no hub, `khb doctor` reports
`matches installed` and flags nothing, and the stale copy sits there stating an older
contract than the CLI implements. Only an explicit `khb upgrade` — which *is* unconditional
— would fix it, and nobody runs that unprompted.

Code-only changes do not have this problem: the CLI is what the user installed, not a copy
inside their hub. It is specifically the files khb copies into a hub that need the bump to
travel, and this repo is its own hub, so the stamp in its `khb.json` should track
`package.json` regardless.

Bump the **patch** digit unless the change is genuinely a feature or a break.

## Steps

Steps 1–3 are both kinds of bump; 4–6 are the release only.

1. **Bump `package.json`'s `version`.** Don't hand-edit `khb.json`'s `"khb"` field — that is
   the stamp of what this hub was last built by, and `khb upgrade` is the only thing that
   sets it. Step 2 is how it gets set.
2. **`bun run upgrade`**, then **`bun run lint`** and **`bun run doctor`**.

   This repo is its own hub, so the bump in step 1 immediately puts the hub a version behind
   the CLI acting on it. Upgrading here restamps `khb.json`, prunes anything the new version
   retired, and — the reason it is a step rather than a habit — makes the release *exercise
   the upgrade path in the one hub where the package and the hub are the same directory*.
   That configuration is unique to this repo and no user will ever hit it, so nothing else
   covers it: `syncManaged()` shipped a `cpSync(src, dest)` with `src === dest`, which turned
   every in-hub command here into an EINVAL crash the moment a version bump created drift.
   A bump that runs upgrade finds that class of bug at release, not weeks later.

   Run it through **`bun run upgrade`**, never a globally-installed `khb`. The stamp comes
   from the `package.json` of whichever khb executes, so a global khb still on the old
   version would quietly stamp the hub with the version you just moved off.

3. **Commit** the bump on `main` — `package.json` and the restamped `khb.json` together.

   **An internal bump stops here.** Everything below turns it into a release.

4. **Tag** `vX.Y.Z` as an annotated tag, message = the release notes (see below), then push
   both: `git push origin main && git push origin vX.Y.Z`.
5. **`gh release create vX.Y.Z --title vX.Y.Z --notes-file <notes>`** — reuse the same notes
   file as the tag message.
6. **`npm publish` is manual, always.** It needs interactive 2FA/OTP, so an agent can't run
   it — ask the maintainer to run it themselves, then verify with
   `npm view @msareen/knowledge-hub-builder version` before calling the release done.

## Release notes

Look at prior tags (`git tag -n99 <tag>` or `gh release view <tag>`) for the shape: a short
recap of what the package is, then a **What's in/fixed in vX.Y.Z** list built from the actual
commits since the last tag (`git log <prev-tag>..HEAD --oneline`), then the doc links and
install snippet. Keep it factual — describe what changed, not why it's good.
