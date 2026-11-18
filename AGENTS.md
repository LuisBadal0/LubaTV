# LubaTV: notes for coding agents

LubaTV is a desktop IPTV player: a Tauri 2 app with a Rust backend (`src-tauri`) and an
Angular frontend (`src`). Playback goes through mpv, re-streaming through ffmpeg.

The global workflow rules (branches, commits, pull requests, versions, secrets) apply.
This file adds what is specific to this repository.

## Set up

- Node.js 24 or newer (npm 11; CI and Docker use it too), Rust 1.91 or newer (stable), and the Tauri prerequisites for the platform.
- `npm ci`. Use npm only: `package-lock.json` is the one lockfile.
- Windows development builds need the player files: `./scripts/fetch-windows-deps.ps1`
  fills the git-ignored `src-tauri/deps`.

## Run and build

| Command | What it does |
|---|---|
| `npm run tauri dev` | Run the app with live reload |
| `npm run build` | Build the packages for this platform |
| `npm run build:windows` | Windows installers with the player files included |
| `pwsh -File scripts/verify/start.ps1 -Fresh` | Run the app with its own data folder and a made-up playlist, for checks |

`npm run tauri dev` uses the real library and providers. To see a change working, use the
`verify` skill (`.claude/skills/verify/SKILL.md`) instead: it starts the app isolated through
`LUBATV_HOME`, drives the window with `scripts/verify/drive.mjs` and checks what mpv plays.
Run it before committing a change users would notice, and report what it showed in **Checks**.

## Test

Run these before saying a change is done, and report the results in the PR's **Checks**:

| Command | Where | CI workflow |
|---|---|---|
| `npm run test:ci` | repository root | Frontend tests |
| `cargo fmt --check` | `src-tauri` | Rust checks |
| `cargo clippy --all-targets -- -D warnings` | `src-tauri` | Rust checks |
| `cargo test` | `src-tauri` | Rust checks |

- `npm run test:ci` needs Chrome. Without it, set `CHROME_BIN` to another Chromium browser,
  such as Edge.
- `cargo test -- --ignored` also runs the tests that start mpv or download files. CI skips them.
- Frontend tests fake the Tauri backend with `mockTauri()` from `src/testing/test-setup.ts`.
  Tests never use real IPTV accounts or playlists; use made-up addresses and fixtures.

## Versions and releases

Releases are batched, as the global rules describe: a user-facing PR adds a bullet under
**Unreleased** in `CHANGELOG.md` and keeps the version. Only a release PR, made when the
owner asks, bumps the version, in all five places. They must match; CI checks the first
three:

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- the `lubatv` entry in `src-tauri/Cargo.lock`
- the top-level `version` fields in `package-lock.json`

`CHANGELOG.md` is the one place for release notes, so write its bullets for the people using
the app. The app shows them:

- **What's new** window after an update: the running version's section, from the copy of
  `CHANGELOG.md` that ships with the app.
- **Update prompt and Settings:** the offered version's section, which CI writes into
  `latest.json`.

Merging the release PR publishes GitHub release `v<version>`, the Windows updater files and the Docker
image. The release notes come from `CHANGELOG.md` through `.github/scripts/release-notes.sh`.
CI's **Check version** job fails when the current version has no dated section with
bullets. Don't create tags or releases by hand. `CONTRIBUTING.md` has the full steps.

## Pull requests

- This repository is a fork. `gh` defaults to the upstream repository, so always pass
  `-R LuisBadal0/LubaTV --base main` to `gh pr create`.
- Use the sections from `.github/pull_request_template.md`: Changes, Checks, Version.
  **Version** is "No version change" except in a release PR.
- When one PR builds on another, base its branch on the other and say "Stacked on #N" at
  the top of the body.
- Before opening a PR, review the diff with fresh context: `/code-review`, plus
  `/security-review` when the change touches credentials, network code, SQL, the updater or
  CI. `REVIEW.md` says what counts as a problem here. Fix what it finds, or say in **Checks**
  why a finding stays.
- Fill in **Risk** and **To undo** in **Checks**. Changes to the updater, the signing key, CI
  workflows, player files, SQL or credential handling are high risk: say what you checked.

## Keeping checks honest

- Never make a check pass by weakening it: no skipped or loosened tests, sleeps or retries to
  get past a flaky test. Find the cause; if you can't, delete the test and say why in the PR.
- When the same mistake turns up in two PRs, turn it into a test, a CI check or a line in
  `REVIEW.md`.
- After three attempts at the same failing check, stop and ask the owner.
- `.claude/settings.json` runs `rustfmt` on Rust files after each edit (`.claude/hooks`). It
  does nothing when rustfmt isn't installed; CI still runs `cargo fmt --check`.
- `main` is protected: merging needs **Check version** and both **build** jobs to pass, and
  force-pushes are refused.

## Things to know

- **Player files (Windows):** mpv, ffmpeg and yt-dlp are pinned by checksum in
  `src-tauri/player-files.json`. Change them through the **Refresh player files** workflow,
  not by hand.
- **Updater signing:** the public key in `tauri.conf.json` must match the
  `TAURI_SIGNING_PRIVATE_KEY` secret. Changing it stops installed copies from updating.
- **Data and logs** live outside the repository (see "Where LubaTV keeps its data" in
  `README.md`). Never commit databases, logs or playlists: they hold provider credentials.
- **SQL:** build queries with `?` placeholders (`generate_placeholders` in the `sql` module), never by
  formatting values into the query text.
