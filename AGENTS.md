# LubaTV: notes for coding agents

LubaTV is a desktop IPTV player: a Tauri 2 app with a Rust backend (`src-tauri`) and an
Angular frontend (`src`). Playback goes through mpv, re-streaming through ffmpeg.

The global workflow rules (branches, commits, pull requests, versions, secrets) apply.
This file adds what is specific to this repository.

## Set up

- Node.js 22.12 or newer, Rust 1.91 or newer (stable), and the Tauri prerequisites for the platform.
- `npm ci`. Use npm only: `package-lock.json` is the one lockfile.
- Windows development builds need the player files: `./scripts/fetch-windows-deps.ps1`
  fills the git-ignored `src-tauri/deps`.

## Run and build

| Command | What it does |
|---|---|
| `npm run tauri dev` | Run the app with live reload |
| `npm run build` | Build the packages for this platform |
| `npm run build:windows` | Windows installers with the player files included |

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

## Versions

The version is stored in three files that must match (CI checks it):

- `package.json`
- `src-tauri/Cargo.toml` (and the matching `lubatv` entry in `src-tauri/Cargo.lock`)
- `src-tauri/tauri.conf.json`

Merging a new version to `main` publishes GitHub release `v<version>`, the Windows updater
files and the Docker image. Don't create tags or releases by hand.

## Pull requests

- This repository is a fork. `gh` defaults to the upstream repository, so always pass
  `-R LuisBadal0/LubaTV --base main` to `gh pr create`.
- Use the sections from `.github/pull_request_template.md`: Changes, Checks, Version.
- When one PR builds on another, base its branch on the other and say "Stacked on #N" at
  the top of the body.

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
