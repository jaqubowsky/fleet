# syntax=docker/dockerfile:1
FROM docker/sandbox-templates:claude-code-docker

LABEL com.docker.sandboxes.start-docker="true"

ENV GIT_TERMINAL_PROMPT=0

{{toolchain}}

ARG UPDATE_BUST=0
RUN claude update \
 && find /home/agent/.local/share/claude/versions -type f \
      ! -samefile "$(readlink -f "$(command -v claude)")" -delete

COPY --from=claude-home --chown=agent:agent CLAUDE.md /home/agent/.claude/CLAUDE.md
COPY --from=claude-home --chown=agent:agent rules/    /home/agent/.claude/rules/
COPY --from=claude-home --chown=agent:agent refs/     /home/agent/.claude/refs/
COPY --from=claude-home --chown=agent:agent skills/   /home/agent/.claude/skills/
COPY --from=claude-home --chown=agent:agent agents/   /home/agent/.claude/agents/
COPY --from=claude-home --chown=agent:agent fleet/    /home/agent/fleet/

RUN playwright-cli install --skills -g \
 && test -r /home/agent/.claude/skills/playwright-cli/SKILL.md

COPY --from=claude-home --chown=agent:agent plugins/  /home/agent/.claude/plugins/

COPY --chmod=0755 container/base-worktree.sh /usr/local/bin/base-worktree
COPY --chmod=0755 container/ticket-check.sh /usr/local/bin/ticket-check

COPY settings.json    /etc/claude-code/managed-settings.json

COPY --from=claude-home --chown=agent:agent git/ /home/agent/
