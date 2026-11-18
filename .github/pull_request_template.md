## Changes

<!-- What is different for the user, as short bullets. -->

-

## Checks

<!-- What you ran and what it showed. Say plainly what you did not test. -->

- [ ] `npm run test:ci`
- [ ] `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` in `src-tauri`
- [ ] Bullet under **Unreleased** in `CHANGELOG.md` (if users will notice the change)
- Tried in the app (the `verify` skill, or by hand):
- Reviewed with `/code-review` (and `/security-review` for credentials, network, SQL, updater or CI):
- Not tested:
- Risk: <!-- low, medium or high, and what could break. High: updater, signing key, CI workflows, player files, SQL, credentials. -->
- To undo: <!-- usually "revert this PR"; say if data or settings need more (a migration, a changed file format). -->

<!--
Every review finding gets an answer: fixed, or a reason it stays.
The verify skill only covers M3U sources on Windows: say what you checked for anything else,
such as Xtream, the TV guide or Linux.
-->

## Version

No version change.

<!--
Releases are batched: keep the version and add a bullet under "Unreleased" in CHANGELOG.md.
Only a release PR (chore/release-x.y.z, "Release x.y.z (vx.y.z)") bumps the version in
package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock and
src-tauri/tauri.conf.json. It also renames "Unreleased" to "[x.y.z] - YYYY-MM-DD", adds a
new empty "Unreleased" above it. That section becomes the GitHub release notes and what
the app shows in its update prompt and What's new window. See CONTRIBUTING.md.
-->
