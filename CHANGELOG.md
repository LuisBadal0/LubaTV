# Changelog

What changes for people using LubaTV, newest first. Each release on GitHub uses
its section from this file as its release notes. Releases before 1.5.0 are
described on the [GitHub releases page](https://github.com/LuisBadal0/LubaTV/releases).

Add a bullet under **Unreleased** in every pull request that changes what users
get, under **Added**, **Changed**, **Fixed** or **Removed**. Releases are
batched: a release pull request bumps the version, renames **Unreleased** to
that version and date, and starts a new, empty **Unreleased** section above it.

## [Unreleased]

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
