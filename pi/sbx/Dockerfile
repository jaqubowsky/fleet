# syntax=docker/dockerfile:1
FROM docker/sandbox-templates:shell-docker

ENV GIT_TERMINAL_PROMPT=0
ENV NODE_OPTIONS=--disable-warning=UNDICI-EHPA

{{toolchain}}

ARG UPDATE_BUST=0
RUN sudo npm install -g --prefix /usr/local/share/npm-global @earendil-works/pi-coding-agent@latest \
 && sudo ln -sf /usr/local/share/npm-global/bin/pi /usr/local/bin/pi \
 && pi --version

COPY --from=pi-home --chown=agent:agent agent/    /home/agent/.pi/agent/
COPY --from=pi-home --chown=agent:agent skills/   /home/agent/.pi/skills/

RUN cp -r /usr/local/share/npm-global/lib/node_modules/@playwright/cli/skills/playwright-cli \
      /home/agent/.pi/skills/playwright-cli \
 && test -r /home/agent/.pi/skills/playwright-cli/SKILL.md

COPY --chown=agent:agent agent-settings.json      /home/agent/.pi/agent/settings.json
COPY --chmod=0755 container/base-worktree.sh       /usr/local/bin/base-worktree
COPY --chmod=0755 container/ci-wait.sh            /usr/local/bin/ci-wait

RUN pkgs="$(node -p "require('/home/agent/.pi/agent/settings.json').packages.map(p => p.replace(/^npm:/, '')).join(' ')")" \
 && mkdir -p /home/agent/.pi/agent/npm \
 && npm install --prefix /home/agent/.pi/agent/npm --legacy-peer-deps --min-release-age=1 $pkgs \
 && ls /home/agent/.pi/agent/npm/node_modules | grep -cE "^pi-|^@"

COPY --from=pi-home --chown=agent:agent git/ /home/agent/

LABEL com.docker.sandboxes.start-docker="true"
LABEL com.docker.sandboxes.flavor="pi"
LABEL com.docker.sandboxes.base="docker/sandbox-templates:shell-docker"

USER agent
WORKDIR /home/agent
CMD ["pi"]
