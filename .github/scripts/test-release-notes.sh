#!/usr/bin/env bash
# Tests release-notes.sh against made-up changelogs.
# Usage, from the repository root: bash .github/scripts/test-release-notes.sh
set -uo pipefail

script="$(cd "$(dirname "$0")" && pwd)/release-notes.sh"
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
failures=0

cat > "$dir/CHANGELOG.md" <<'EOF'
# Changelog

## [Unreleased]

- Not released yet.

## [1.2.0] - 2026-01-02

### Added

- A new thing.

## [1.1.0]

- Missing its date.

## [1.0.1] - 2026-01-01

## [1.0.0] - 2025-12-31

- First release.
EOF
printf '## [2.0.0] - 2026-02-02\r\n\r\n- Saved with Windows line endings.\r\n' > "$dir/crlf.md"

expect_notes() { # name, version, file, expected output
  local out
  if ! out=$(bash "$script" "$2" "$3" 2>/dev/null); then
    echo "FAIL $1: exited with an error"; failures=$((failures + 1))
  elif [ "$out" != "$4" ]; then
    printf 'FAIL %s: got\n%s\n' "$1" "$out"; failures=$((failures + 1))
  else
    echo "ok   $1"
  fi
}

expect_error() { # name, version, file
  if bash "$script" "$2" "$3" >/dev/null 2>&1; then
    echo "FAIL $1: should have failed"; failures=$((failures + 1))
  else
    echo "ok   $1"
  fi
}

expect_notes "prints the section without its heading" 1.2.0 "$dir/CHANGELOG.md" "$(printf '### Added\n\n- A new thing.')"
expect_notes "reads the last section" 1.0.0 "$dir/CHANGELOG.md" "- First release."
expect_notes "ignores Windows line endings" 2.0.0 "$dir/crlf.md" "- Saved with Windows line endings."
expect_error "fails without a section" 9.9.9 "$dir/CHANGELOG.md"
expect_error "fails without a date" 1.1.0 "$dir/CHANGELOG.md"
expect_error "fails without changes" 1.0.1 "$dir/CHANGELOG.md"
expect_error "doesn't match a longer version" 1.0 "$dir/CHANGELOG.md"
expect_error "fails without a changelog" 1.0.0 "$dir/missing.md"

[ "$failures" -eq 0 ] || { echo "$failures failed"; exit 1; }
