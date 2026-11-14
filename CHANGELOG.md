# Changelog

What changes for people using LubaTV, newest first. Each release on GitHub uses
its section from this file as its release notes. Releases before 1.5.0 are
described on the [GitHub releases page](https://github.com/LuisBadal0/LubaTV/releases).

Add a bullet under **Unreleased** in every pull request that changes what users
get, under **Added**, **Changed**, **Fixed** or **Removed**. Releases are
batched: a release pull request bumps the version, renames **Unreleased** to
that version and date, and starts a new, empty **Unreleased** section above it.

## [Unreleased]

### Added

- The home screen opens with the last thing you watched, ready to start again. For a live channel with a TV guide it shows what is on now, how far along it is and what comes next.

### Changed

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
