# Releasing

Maintainer-only. Not shipped into hubs — unlike `AGENTS.md`/`CLAUDE.md`/`SPEC.md`, this file
is not in `package.json`'s `files`, so `khb upgrade` never touches it and users never see it.

## Steps

1. **Bump `package.json`'s `version`.** Leave `khb.json`'s own `"khb"` field alone — that's
   the stamp of what's actually installed in *this* hub, and only `khb upgrade` sets it, once
   the new version is really installed.
2. **Commit** the bump on `main`.
3. **Tag** `vX.Y.Z` as an annotated tag, message = the release notes (see below), then push
   both: `git push origin main && git push origin vX.Y.Z`.
4. **`gh release create vX.Y.Z --title vX.Y.Z --notes-file <notes>`** — reuse the same notes
   file as the tag message.
5. **`npm publish` is manual, always.** It needs interactive 2FA/OTP, so an agent can't run
   it — ask the maintainer to run it themselves, then verify with
   `npm view @msareen/knowledge-hub-builder version` before calling the release done.

## Release notes

Look at prior tags (`git tag -n99 <tag>` or `gh release view <tag>`) for the shape: a short
recap of what the package is, then a **What's in/fixed in vX.Y.Z** list built from the actual
commits since the last tag (`git log <prev-tag>..HEAD --oneline`), then the doc links and
install snippet. Keep it factual — describe what changed, not why it's good.
