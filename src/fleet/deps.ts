export const INSTALL_LOG = "/tmp/fleet-install.log";

export const installScript = [
	"set -eu",
	'cd "$WORKSPACE_DIR"',
	'eval "$(fnm env --shell bash)"',
	"fnm use --install-if-missing >/dev/null",
	"find . -maxdepth 6 -type f \\( -name yarn.lock -o -name pnpm-lock.yaml -o -name package-lock.json \\) \\",
	"  -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/build/*' | sort | while read -r lock; do",
	'  root="$(dirname "$lock")"',
	'  [ -f "$root/package.json" ] || continue',
	'  echo "deps: $root"',
	'  log="/tmp/deps-$(echo "$root" | tr \'/.\' \'__\').log"',
	'  ( cd "$root" && case "$(basename "$lock")" in',
	"      pnpm-lock.yaml) npm_config_ignore_scripts=false pnpm install --frozen-lockfile ;;",
	"      package-lock.json) npm_config_ignore_scripts=false npm ci ;;",
	"      yarn.lock) if grep -q '^__metadata:' yarn.lock; then YARN_ENABLE_SCRIPTS=true yarn install --immutable; else npm_config_ignore_scripts=false yarn install --frozen-lockfile; fi ;;",
	'    esac ) >"$log" 2>&1 || { tail -30 "$log"; exit 1; }',
	"done",
	"echo deps: ready",
].join("\n");
