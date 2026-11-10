# Contributing

## Set up

You need [Node.js](https://nodejs.org/) 24 or newer (with npm 11), [Rust](https://www.rust-lang.org/tools/install)
1.91 or newer, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your
platform.

```
npm ci
```

Use npm only: `package-lock.json` is the one lockfile. On Windows, development builds also need
the player files: `./scripts/fetch-windows-deps.ps1` puts mpv, ffmpeg and yt-dlp in the
git-ignored `src-tauri/deps`.

## Run

```
npm run tauri dev      # the app, with live reload
npm run build          # packages for this platform, in src-tauri/target/release/bundle
npm run build:windows  # Windows installers with the player files included
```

The app uses your real library and contacts your IPTV providers. Frontend tests fake the
backend with `mockTauri()` from `src/testing/test-setup.ts`.

## Test

Run these before opening a pull request. CI runs them too.

```
npm run test:ci        # frontend tests, in headless Chrome

cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test             # add -- --ignored for the tests that start mpv or download files
```

Without Chrome, set `CHROME_BIN` to another Chromium browser, such as Edge. Tests never use
real IPTV accounts or playlists: use made-up addresses and fixtures.

## Branches and pull requests

- Branch from `main`: `feature/<name>`, `fix/<name>`, `chore/<name>` or `docs/<name>`,
  lowercase and hyphenated. One focused change per branch.
- Open a pull request against `main` of `LuisBadal0/LubaTV`. This repository is a fork, so pass
  `-R LuisBadal0/LubaTV --base main` to `gh pr create`.
- Fill in the template: **Changes**, **Checks** and **Version**. CI must pass. Pull requests
  are squash-merged.
- If users will notice the change, add a bullet under **Unreleased** in
  [CHANGELOG.md](CHANGELOG.md), written for them, under **Added**, **Changed**, **Fixed** or
  **Removed**. Leave the version alone.

## Versions and releases

LubaTV uses [semantic versioning](https://semver.org). The version is in `package.json`,
`package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (the `lubatv` entry) and
`src-tauri/tauri.conf.json`. CI fails if `package.json`, `Cargo.toml` and `tauri.conf.json`
disagree.

Releases are batched. When the maintainer decides to release, a separate pull request on
`chore/release-x.y.z`, titled `Release x.y.z (vx.y.z)`:

1. Picks MAJOR, MINOR or PATCH from everything under **Unreleased**.
2. Bumps the version in all five places.
3. Renames **Unreleased** to `[x.y.z] - YYYY-MM-DD` and adds a new, empty **Unreleased**
   above it.

That section is all the release notes there are. The app shows it in two places:

- **Update prompt and Settings:** CI writes the section into `latest.json`, so these show
  it before updating.
- **What's new** window after updating: `CHANGELOG.md` ships with the app, and the window
  reads it from there.

When it merges, CI publishes:

- GitHub release `vx.y.z` with the Windows installers and Linux packages. Its notes are the
  version's `CHANGELOG.md` section, the install instructions and GitHub's list of merged pull
  requests.
- The Windows update installers, their signatures and `latest.json`, for the in-app updater.
- The Docker image `ghcr.io/luisbadal0/lubatv:<version>`.

CI's **Check version** job fails when the current version has no dated `CHANGELOG.md` section
with at least one bullet (`.github/scripts/release-notes.sh`). A version that is already
released is not published again. For an urgent fix, open the release pull request right after
the fix merges. Don't create tags or releases by hand.

The update installers are signed with the `TAURI_SIGNING_PRIVATE_KEY` secret. The matching
public key is in `src-tauri/tauri.conf.json`; changing it stops installed copies from updating.

## Player files on Windows

mpv, ffmpeg and yt-dlp are pinned by checksum in `src-tauri/player-files.json`. To update them,
run the **Refresh player files** workflow, open a pull request from the branch it pushes and add
a line under **Unreleased**. Don't edit `player-files.json` by hand. The README has the details.

## What not to commit

Databases, logs and playlists (they hold provider credentials), credentials, tokens, keys,
`.env` files, personal screenshots and build output. Installers belong on GitHub Releases.
