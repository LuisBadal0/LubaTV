#!/usr/bin/env bash
# Prints the CHANGELOG.md section for a version, which becomes its GitHub release
# notes. Exits non-zero when that section is missing, has no release date or lists
# no changes, so a release PR can't merge without its notes.
# Usage, from the repository root: bash .github/scripts/release-notes.sh <version> [changelog]
set -euo pipefail

version=${1:?usage: release-notes.sh <version> [changelog]}
changelog=${2:-CHANGELOG.md}
[ -f "$changelog" ] || { echo "::error::$changelog is missing" >&2; exit 1; }

# The "## [<version>] ..." heading and everything up to the next "## " heading.
section=$(tr -d '\r' < "$changelog" | awk -v heading="## [$version]" '
  /^## / { if (found) exit; if (index($0, heading) == 1) found = 1 }
  found { print }
')
if [ -z "$section" ]; then
  echo "::error::$changelog has no section for $version" >&2; exit 1
fi

title=$(printf '%s\n' "$section" | head -n 1)
escaped=$(printf '%s' "$version" | sed 's/[.+]/\\&/g')
if ! printf '%s\n' "$title" | grep -Eq "^## \[$escaped\] - [0-9]{4}-[0-9]{2}-[0-9]{2}[[:space:]]*$"; then
  echo "::error::$changelog's section for $version has no release date (## [$version] - YYYY-MM-DD)" >&2
  exit 1
fi

body=$(printf '%s\n' "$section" | tail -n +2 | sed '/./,$!d')
if ! printf '%s\n' "$body" | grep -q '^- '; then
  echo "::error::$changelog's section for $version lists no changes" >&2; exit 1
fi
printf '%s\n' "$body"
