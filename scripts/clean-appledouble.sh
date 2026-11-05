#!/bin/sh
# Delete macOS AppleDouble ("._*") files under the repo (including .git and node_modules).
# macOS writes one beside every file on exFAT/FAT drives; forge, git and tsc then choke on them.
# Harmless no-op on APFS. Usage: sh scripts/clean-appledouble.sh [dir]
root="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
find "$root" -name '._*' -type f -delete 2>/dev/null
exit 0
