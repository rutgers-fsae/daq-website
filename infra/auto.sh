#!/usr/bin/env bash
# Commits any untracked (not gitignored) *.csv files in a repo.
# Usage: auto_commit_untracked.sh /path/to/repo
# Only untracked .csv files are added and committed; edits to already-tracked
# files and anything you have staged are left alone.

set -euo pipefail

REPO="${1:?Usage: $0 /path/to/repo}"
LOCK="/tmp/auto_commit_untracked_$(echo "$REPO" | md5sum | cut -c1-8).lock"

# Cron runs with a minimal PATH
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

# Prevent overlapping runs
exec 9>"$LOCK"
flock -n 9 || { echo "$(date -Is) another run is in progress, skipping"; exit 0; }

cd "$REPO"

# Bail out if this isn't a git repo
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "$(date -Is) ERROR: $REPO is not a git repository" >&2
  exit 1
}

# List untracked .csv files at any depth, respecting .gitignore
# (NUL-delimited for odd filenames)
FILES="$(mktemp)"
trap 'rm -f "$FILES"' EXIT
git ls-files -z --others --exclude-standard -- '*.csv' > "$FILES"

if [ ! -s "$FILES" ]; then
  echo "$(date -Is) no untracked .csv files"
  exit 0
fi

COUNT="$(tr -cd '\0' < "$FILES" | wc -c)"

# Stage and commit only those files
git add --pathspec-from-file="$FILES" --pathspec-file-nul
git commit -q -m "auto: commit $COUNT untracked csv file(s) at $(date '+%Y-%m-%d %H:%M')" \
  --pathspec-from-file="$FILES" --pathspec-file-nul

echo "$(date -Is) committed $COUNT untracked csv file(s)"

# Uncomment to push after each commit:
# git push origin HEAD
