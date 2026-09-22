#!/bin/sh
here="$(dirname "$(readlink -f "$0")")"
node "$here/guard.ts"
status=$?
[ "$status" -eq 0 ] && exit 0
echo "guard: the policy did not answer (exit $status), so this tool call is refused; check node on PATH and $here/guard.ts" >&2
exit 2
