PLUGINS="$STAGE/plugins"
MARKET=claude-plugins-official
LSP=typescript-lsp
LSP_VERSION=1.0.0
mkdir -p "$PLUGINS/marketplaces" "$PLUGINS/cache/$MARKET"
cp -R "$HOME/.claude/plugins/marketplaces/$MARKET" "$PLUGINS/marketplaces/"
cp -R "$HOME/.claude/plugins/cache/$MARKET/$LSP" "$PLUGINS/cache/$MARKET/"
find "$PLUGINS" -name .in_use -type d -delete
jq --arg loc "/home/agent/.claude/plugins/marketplaces/$MARKET" \
   '.[] |= (.installLocation = $loc | .autoUpdate = false)' \
   "$HOME/.claude/plugins/known_marketplaces.json" > "$PLUGINS/known_marketplaces.json"
jq --arg id "$LSP@$MARKET" \
   --arg path "/home/agent/.claude/plugins/cache/$MARKET/$LSP/$LSP_VERSION" \
   '{version: .version, plugins: {($id): [ .plugins[$id][0] | .installPath = $path ]}}' \
   "$HOME/.claude/plugins/installed_plugins.json" > "$PLUGINS/installed_plugins.json"

BUILD_ARGS+=(--build-arg "CLAUDE_UPDATE_BUST=$(date +%Y%m%d)-$(claude --version 2>/dev/null | tr -cd '0-9.' || true)")
