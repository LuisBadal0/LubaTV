## Changes

<!-- What is different for the user, as short bullets. -->

-

## Checks

<!-- What you ran and what it showed. Say plainly what you did not test. -->

- [ ] `npm run test:ci`
- [ ] `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` in `src-tauri`
- [ ] Bullet under **Unreleased** in `CHANGELOG.md` (if users will notice the change)
- Tried in the app:
- Not tested:

## Version

No version change.

<!--
Releases are batched: keep the version and add a bullet under "Unreleased" in CHANGELOG.md.
Only a release PR (chore/release-x.y.z, "Release x.y.z (vx.y.z)") bumps the version in
package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock and
src-tauri/tauri.conf.json. It also renames "Unreleased" to "[x.y.z] - YYYY-MM-DD", adds a
new empty "Unreleased" above it and updates the What's new window. That section becomes
the GitHub release notes when it merges. See CONTRIBUTING.md.
-->
