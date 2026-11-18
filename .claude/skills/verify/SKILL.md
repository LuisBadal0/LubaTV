---
name: verify
description: Run LubaTV with a made-up playlist and check a change works in the real app, from a click in the window to video playing in mpv. Use before committing any change to what the app shows or does, and whenever asked to run, try, test by hand or screenshot LubaTV. Windows only.
---

# Verify a change in the running app

Unit tests fake the backend, so they can't show that a feature works. This skill runs the
real app (Angular + Rust + mpv) against a made-up playlist, drives the window and checks what
mpv plays. Run it before committing a change users would notice, and say in the PR's
**Checks** what you exercised and what you saw.

It never touches the user's library: `LUBATV_HOME` moves the database, cache, logs, player
files and WebView storage into a folder of their own, and the old app's data is ignored.

## 1. Start the app

Run in the background (it keeps running until stopped), from the repository root:

```
pwsh -File scripts/verify/start.ps1 -Fresh
```

- `-Fresh` starts from "Add your first source". Leave it out to keep the library from the last
  run.
- Ports 4200 (dev server), 8765 (playlist) and 9222 (DevTools) must be free. The script stops
  and says so if one is taken; don't stop processes you didn't start, tell the user.
- An installed LubaTV can stay open; this run is a separate instance.
- The first build takes a few minutes. Wait until the window answers:

```
node scripts/verify/drive.mjs wait body 300000
```

## 2. Add the made-up playlist

The playlist at `http://127.0.0.1:8765/playlist.m3u` has six live channels in News, Sports and
Kids (names start with `PT:` or `US:` for country search) and two movies.

```
node scripts/verify/drive.mjs wait-text "Add your first source"
node scripts/verify/drive.mjs click-text "M3U link"
node scripts/verify/drive.mjs type "#source-name" "Test provider"
node scripts/verify/drive.mjs type "#source-url" "http://127.0.0.1:8765/playlist.m3u"
node scripts/verify/drive.mjs click-text "Fetch playlist"
node scripts/verify/drive.mjs wait-text "Test News One" 30000
```

## 3. Exercise the change

Do what a user would do to reach the feature, through the window, then check the result.
The top of `scripts/verify/drive.mjs` lists every command; the main ones:

| Command | Use |
|---|---|
| `wait <css>` / `wait-text <text>` | Wait for something to appear (default 15 s; add ms to change) |
| `click <css>` / `click-text <text>` | Click; waits until the element is visible and enabled |
| `type <css> <text>` | Type with real key presses (the search box reacts to key events) |
| `key <key>` | `Enter`, `Escape`, `ArrowDown`, `Control+f`, `F1`, ... |
| `text [css]` | Read what the page shows |
| `eval <js>` | Read state the page doesn't show; keep it to reading |
| `screenshot <file.png>` | Picture of the window. Look at it for layout changes |
| `mpv` | What each mpv window plays: path, playback time, paused |
| `mpv-shot <file.png>` | The video frame mpv shows right now |

Playback is confirmed when `mpv` reports the expected `path`, `pause: false` and a
`playback-time` that grows between two calls a second or more apart.
`curl http://127.0.0.1:8765/requests` lists the streams requested so far.

Save screenshots in the scratchpad, never in the repository. They are of made-up data, so
they may go in a PR if they help a reviewer.

## 4. When something fails

- Read the start command's output (Angular and Rust errors) and the app's log in
  `<data folder>/cache/logs`, under the folder `start.ps1` printed. The log only exists once
  something has gone wrong.
- Fix the code and check again. After three rounds that don't work, stop and tell the user what
  fails, what you tried and what you saw.
- Don't loosen a check, add sleeps or skip a step to get a pass.

## 5. Stop

Stop the background start command. That ends the app, its mpv windows and the playlist server.
Closing the window only hides LubaTV in the tray.

## What this can't check

- Xtream sources, the TV guide, catch-up and series: the made-up provider is M3U only.
- Native dialogs (choosing a file, saving an export): the driver can't click them.
- Linux and macOS: their WebViews have no DevTools port.

Say so in **Checks** when a change touches these, and what you checked instead.
