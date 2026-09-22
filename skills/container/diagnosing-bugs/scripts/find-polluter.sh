#!/usr/bin/env bash
# Bisection loop for "the test run leaves something behind, and I don't know which test".
# Runs the suite one file at a time and stops at the first file that makes <path> appear.
#
# Usage:
#   bash find-polluter.sh <path-that-appears> <test-file-glob>
#
# Examples:
#   bash find-polluter.sh .git 'src/**/*.test.ts'
#   TEST_CMD='pytest -q' bash find-polluter.sh /tmp/leaked.sock 'tests/**/*_test.py'
#
# The runner defaults to `npm test`; override with TEST_CMD. The test file path
# is appended as the last argument.
#
# Exit codes: 0 = clean, 1 = polluter found, 2 = usage / preconditions.

set -uo pipefail

if [ $# -ne 2 ]; then
  echo "usage: $0 <path-that-appears> <test-file-glob>" >&2
  exit 2
fi

POLLUTION_PATH="$1"
TEST_GLOB="${2#./}"
TEST_CMD="${TEST_CMD:-npm test}"

if [ -e "$POLLUTION_PATH" ]; then
  echo "'$POLLUTION_PATH' already exists before the first test." >&2
  echo "Remove it first, otherwise every run looks polluted." >&2
  exit 2
fi

# `find -path` cannot match '**/' against zero directories, so a glob like
# src/**/*.test.ts would miss src/top.test.ts. Try the collapsed form too.
TEST_FILES="$(find . \( -path "./$TEST_GLOB" -o -path "./${TEST_GLOB//\*\*\//}" \) -type f | sort -u)"

if [ -z "$TEST_FILES" ]; then
  echo "no files matched: $TEST_GLOB" >&2
  exit 2
fi

TOTAL="$(printf '%s\n' "$TEST_FILES" | wc -l | tr -d ' ')"

echo "watching for: $POLLUTION_PATH"
echo "runner:       $TEST_CMD <file>"
echo "files:        $TOTAL"
echo

INDEX=0
while IFS= read -r TEST_FILE; do
  INDEX=$((INDEX + 1))
  printf '[%d/%d] %s\n' "$INDEX" "$TOTAL" "$TEST_FILE"

  $TEST_CMD "$TEST_FILE" >/dev/null 2>&1

  if [ -e "$POLLUTION_PATH" ]; then
    echo
    echo "POLLUTER: $TEST_FILE"
    echo "created:  $POLLUTION_PATH"
    ls -ld "$POLLUTION_PATH"
    echo
    echo "reproduce with: $TEST_CMD $TEST_FILE"
    exit 1
  fi
done <<< "$TEST_FILES"

echo
echo "no polluter found in $TOTAL files."
exit 0
