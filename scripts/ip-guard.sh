#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
patterns=$(mktemp)
trap 'rm -f "$patterns"' EXIT
# Terms are literal strings; never evaluate them as shell code or regexes.
printf '%s' "${IP_GUARD_TERMS:-}" | tr ',' '\n' | sed '/^[[:space:]]*$/d' > "$patterns"
if [[ -f .ip-guard-terms ]]; then
  sed '/^[[:space:]]*$/d' .ip-guard-terms >> "$patterns"
fi
if [[ ! -s "$patterns" ]]; then
  echo "IP guard: no terms configured; skipping scan."
  exit 0
fi
set +e
git grep -n -i -I -F -f "$patterns" -- .
status=$?
set -e
case "$status" in
  0) echo "IP guard: prohibited wording found." >&2; exit 1 ;;
  1) echo "IP guard: no matches." ;;
  *) echo "IP guard: scan failed." >&2; exit "$status" ;;
esac
