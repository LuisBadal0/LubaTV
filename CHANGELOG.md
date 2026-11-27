# Changelog

What changes for people using LubaTV, newest first. Each release on GitHub uses
its section from this file as its release notes. Releases before 1.5.0 are
described on the [GitHub releases page](https://github.com/LuisBadal0/LubaTV/releases).

Add a bullet under **Unreleased** in every pull request that changes what users
get, under **Added**, **Changed**, **Fixed** or **Removed**. Releases are
batched: a release pull request bumps the version, renames **Unreleased** to
that version and date, and starts a new, empty **Unreleased** section above it.

## [Unreleased]

## [1.8.1] - 2026-11-27

### Changed

- When an Xtream account fails to load, the error now says why: the HTTP error the provider sent, an empty answer, a refused username or password, or the start of a web page it sent instead of its channel list (with any username and password hidden). Before, it only said "Too many Xtream requests failed" or "error decoding response body". The same goes for series episodes and the TV guide.

### Fixed

- Re-streaming a channel now sends all of the playlist's headers for it (Origin, Referer and user agent) and falls back to the source's stream user agent, as playing it does. Before, only the last header reached the provider, so channels that check the Referer could fail to re-stream.
- LubaTV no longer plays a playlist entry whose address starts with "-". mpv would have read it as a setting rather than a stream, so a hostile playlist or shared file could change how mpv runs. Playlist header values that would let it add headers of its own to the request (a line break in any header, or a comma in Origin or Referer) are now ignored for the same reason.
- Channels followed by a comment line in an M3U playlist (such as `# === News ===`) play again. LubaTV used to take the comment as the channel's address, which most often broke the last channel of each category.
- The TV guide of an Xtream channel opens even when the provider leaves fields out of it, such as a programme's end time ("missing field `end`"), its description or its catch-up flags, or sends titles as plain text. A programme that can't be read is skipped instead of failing the whole guide.
- **Refresh all** (and refreshing on start) no longer stops at the first source that fails. The sources after it are still refreshed, and the error names every source that couldn't be refreshed.

## [1.8.0] - 2026-11-18

### Changed

- Updating LubaTV now shows a full-window screen in LubaTV's own style: the download with its progress in MB, then installing, then reopening. The Windows installer window no longer appears, a notification says LubaTV is coming back while it is closed, and it reopens by itself a few seconds later. Anything playing stops before the update instead of carrying on in the background. If an update fails, the screen says which step failed and lets you try again without downloading it again. You'll see this from the next update after this version.

## [1.7.1] - 2026-11-18

### Fixed

- Your IPTV username and password no longer appear in LubaTV's log files or in error messages. Before, a failed request to an Xtream account or playlist link could write the full link, with your credentials, to the log. If you have shared an old log file, consider changing your provider password.

## [1.7.0] - 2026-11-14

### Added

- The home screen opens with the last thing you watched, ready to start again. For a live channel with a TV guide it shows what is on now, how far along it is and what comes next.
- With a category open in a wide window, the other categories are listed on the left: favorites first, a box to filter them by name, and a star on each to add it to the sidebar. Choosing one switches category without going back.

### Changed

- Channels, movies and series are picture-first tiles: the name sits under the picture, and pointing at a tile rings it and shows a play button.
- Movie and series pictures fill their tile instead of sitting small in the middle. With **Live TV** switched off, the grid becomes a wall of upright posters.
- The sidebar is now a narrow column of icons, which leaves more room for channels. Point at it, or reach it with the keyboard, and it opens into the full menu with your views, favorite categories and sources. The pin at the top of the menu keeps it open, as before.
- Sources in the menu show their type, and **Manage** opens them in Settings.

## [1.6.0] - 2026-11-10

### Added

- When an update is available, **What's new** in the update prompt, and Settings → About, list what the new version changes.

### Changed

- The **What's new** window after an update shows the same notes as the GitHub release.

## [1.5.0] - 2026-11-10

### Added

- **Favorite categories** in the sidebar. Open a category and choose **Add to sidebar**, or right-click a category tile. They stay after a source refresh.
- Rows of your favorite categories on the home screen, each with **Show all**.
- **Search by country.** Type a country code in capitals, such as `PT` or `US`, to see that country's categories and channels. Keep typing to search within it; Backspace or × removes it. A code typed in lowercase still searches names, and LubaTV offers the country as a suggestion.
- Inside a category, a channel list with a preview pane: a Watch button, a favorite button and, for Xtream channels, the TV guide.

### Changed

- The home screen fits big windows: wider cards with bigger logos and names, and larger **Continue watching** cards.
- Live channels no longer carry a LIVE label, and the source name only shows when you have more than one source.
- Channel names that start with a country, such as `PT: Sport TV 1`, show the country as a tag and the name without it.
