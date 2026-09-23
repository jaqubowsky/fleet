# syntax=docker/dockerfile:1
FROM docker/sandbox-templates:shell-docker

ENV GIT_TERMINAL_PROMPT=0
ENV NODE_OPTIONS=--disable-warning=UNDICI-EHPA

{{toolchain}}

ARG PI_VERSION=0.87.1

RUN sudo npm install -g --prefix /usr/local/share/npm-global "@earendil-works/pi-coding-agent@$PI_VERSION" \
 && sudo ln -sf /usr/local/share/npm-global/bin/pi /usr/local/bin/pi \
 && pi --version

COPY --from=pi-home --chown=agent:agent agent/    /home/agent/.pi/agent/
COPY --from=pi-home --chown=agent:agent skills/   /home/agent/.pi/skills/

RUN cp -r /usr/local/share/npm-global/lib/node_modules/@playwright/cli/skills/playwright-cli \
      /home/agent/.pi/skills/playwright-cli \
 && test -r /home/agent/.pi/skills/playwright-cli/SKILL.md

COPY --chown=agent:agent agent-settings.json      /home/agent/.pi/agent/settings.json
COPY --chown=agent:agent extensions/             /home/agent/.pi/sbx/extensions/
COPY --chmod=0755 container/base-worktree.sh       /usr/local/bin/base-worktree

RUN pkgs="$(node -p "require('/home/agent/.pi/agent/settings.json').packages.map(p => p.replace(/^npm:/, '')).join(' ')")" \
 && mkdir -p /home/agent/.pi/agent/npm \
 && npm install --prefix /home/agent/.pi/agent/npm --legacy-peer-deps $pkgs \
 && ls /home/agent/.pi/agent/npm/node_modules | grep -cE "^pi-|^@"

COPY --from=pi-home --chown=agent:agent .gitconfig      /home/agent/.gitconfig
COPY --from=pi-home --chown=agent:agent allowed_signers /home/agent/.config/git/allowed_signers
COPY --from=pi-home --chown=agent:agent .gitconfig-work /home/agent/.gitconfig-work
COPY --from=pi-home --chown=agent:agent .gitconfig-alice /home/agent/.gitconfig-alice

LABEL com.docker.sandboxes.start-docker="true"
LABEL com.docker.sandboxes.flavor="pi"
LABEL com.docker.sandboxes.base="docker/sandbox-templates:shell-docker"

USER agent
WORKDIR /home/agent
CMD ["pi"]
