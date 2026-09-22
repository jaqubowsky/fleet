#!/bin/sh
here="$(dirname "$(readlink -f "$0")")"
node="$(command -v node)"
for candidate in /opt/homebrew/bin/node "$HOME"/.nvm/versions/node/*/bin/node; do
	[ -n "$node" ] && break
	[ -x "$candidate" ] && node="$candidate"
done
[ -n "$node" ] && "$node" "$here/guard.ts"
status=$?
[ -n "$node" ] && [ "$status" -eq 0 ] && exit 0
echo "guard: the policy did not answer (node: ${node:-none found}, exit $status), so this tool call is refused; check $here/guard.ts" >&2
exit 2
