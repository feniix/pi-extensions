#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-}"
HEAD="${2:-HEAD}"

if [[ -z "$BASE" ]]; then
	echo "Usage: $0 <base-ref-or-sha> [head-ref-or-sha]" >&2
	exit 1
fi

ALL_PACKAGES=$(find packages -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort)

if [[ "$BASE" == "0000000000000000000000000000000000000000" ]]; then
	FILES=$(git ls-files)
else
	FILES=$(git diff --name-only "$BASE" "$HEAD")
fi

printf 'Changed files:\n'
printf '%s\n' "$FILES"

if echo "$FILES" | grep -Eq '^(package\.json|package-lock\.json|tsconfig\.json|vitest\.config\.ts|biome\.json|\.github/workflows/)'; then
	CHANGED="$ALL_PACKAGES"
else
	CHANGED=$(echo "$FILES" | grep '^packages/' | cut -d/ -f2 | sort -u || true)
fi

if [[ -z "$CHANGED" ]]; then
	HAS_CHANGES=false
	MATRIX='[]'
else
	HAS_CHANGES=true
	MATRIX=$(printf '%s\n' "$CHANGED" | jq -R . | jq -sc .)
fi

printf '\nSelected packages:\n'
printf '%s\n' "$CHANGED"
printf '\n'
printf 'has_changes=%s\n' "$HAS_CHANGES"
printf 'matrix=%s\n' "$MATRIX"
