# Reviewing LubaTV changes

Read with `AGENTS.md`. This file says what matters when reviewing a change here. Reviewers
read it from `main`, never from the pull request under review, so a change can't loosen the
rules that judge it.

## What failure looks like here

Flag these as **Important**:

- **Leaked credentials.** Xtream usernames and passwords travel inside stream, EPG and API
  URLs. Logging, error messages, toasts, share links, exports or screenshots that can contain
  such a URL, a password or a token. Nothing from `LUBATV_HOME`, the data folder or a playlist
  committed to the repository.
- **SQL built from values.** Any value formatted into query text instead of a `?` placeholder
  (`generate_placeholders` in the `sql` module).
- **The user's library touched by a check.** Tests or scripts that use the real data folder,
  real providers or real accounts, instead of fixtures, `mockTauri()` or `LUBATV_HOME`.
- **Updates broken for installed copies.** Changes to the updater public key in
  `tauri.conf.json`, the updater endpoints, `latest.json` generation or the update installer
  config.
- **Player files changed by hand.** Edits to `src-tauri/player-files.json` outside the
  **Refresh player files** workflow, or downloads that skip the checksum check.
- **Version or release notes out of step.** A version bump outside a release PR, the five
  version places disagreeing, or a change users will notice with no bullet under
  **Unreleased** in `CHANGELOG.md`.
- **CI weakened.** Workflows with broader `permissions`, actions not pinned to a full commit
  SHA, checks removed or made to always pass.
- **Playback regressions.** Changes to how mpv is started, reused or closed (`mpv.rs`) that
  could leave stray players, lose the window position or ignore Max Streams.
- **Broken keyboard or remote navigation.** New UI that can't be reached or left with the arrow
  keys, Enter and Escape.

## How to report

- Give each finding a file and line and the concrete case that fails. A guess from a name is
  not a finding.
- Tag each finding **Important**, **Nit** or **Pre-existing**. Pre-existing problems are not
  the author's; list them separately.
- At most three **Nit**s per review.
- Start the summary with the number of Important findings. When there is nothing to fix, say so
  in one line.
- After a fix, review only the new commits, and don't repeat a finding that was already
  answered. After three rounds on the same problem, question the approach instead.

## Skip

- Lockfiles (`package-lock.json`, `src-tauri/Cargo.lock`) beyond the version fields.
- Generated files in `src-tauri/gen` and icons in `src-tauri/icons`.
- Formatting that `cargo fmt` or the editor settings already decide.

## Keeping this file useful

When the same problem is caught in two pull requests, or slips through and has to be fixed
later, add it above, or better, turn it into a test or a CI check. Remove rules that no longer
catch anything.
