# syntax=docker/dockerfile:1
FROM docker/sandbox-templates:shell-docker

ENV GIT_TERMINAL_PROMPT=0
ENV NODE_OPTIONS=--disable-warning=UNDICI-EHPA

{{toolchain}}

ARG UPDATE_BUST=0
RUN case "$(dpkg --print-architecture)" in \
      arm64) asset=omp-linux-arm64 ;; \
      amd64) asset=omp-linux-x64 ;; \
      *) echo "omp: unsupported architecture $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac \
 && curl -fsSL "https://github.com/can1357/oh-my-pi/releases/latest/download/${asset}" -o /tmp/omp \
 && sum="$(curl -fsSL "https://github.com/can1357/oh-my-pi/releases/latest/download/SHA256SUMS.txt" | awk -v a="$asset" '$2 == a { print $1 }')" \
 && test -n "$sum" && echo "$sum  /tmp/omp" | sha256sum -c - \
 && sudo install -m 0755 /tmp/omp /usr/local/bin/omp \
 && rm /tmp/omp \
 && omp --version

COPY --from=omp-home --chown=agent:agent agent/  /home/agent/.omp/agent/
COPY --from=omp-home --chown=agent:agent skills/ /home/agent/.omp/skills/

RUN cp -r /usr/local/share/npm-global/lib/node_modules/@playwright/cli/skills/playwright-cli \
      /home/agent/.omp/skills/playwright-cli \
 && test -r /home/agent/.omp/skills/playwright-cli/SKILL.md

COPY --chown=agent:agent agent-config.yml /home/agent/.omp/agent/config.yml
COPY --chown=agent:agent extensions/ /home/agent/sbx/extensions/
COPY --chmod=0755 container/base-worktree.sh /usr/local/bin/base-worktree
COPY --chmod=0755 container/ticket-check.sh /usr/local/bin/ticket-check
COPY --chmod=0755 container/omp-entrypoint /usr/local/bin/omp-entrypoint

COPY --from=omp-home --chown=agent:agent .gitconfig /home/agent/.gitconfig
COPY --from=omp-home --chown=agent:agent allowed_signers /home/agent/.config/git/allowed_signers
COPY --from=omp-home --chown=agent:agent .gitconfig-work /home/agent/.gitconfig-work
COPY --from=omp-home --chown=agent:agent .gitconfig-alice /home/agent/.gitconfig-alice

LABEL com.docker.sandboxes.start-docker="true"
LABEL com.docker.sandboxes.flavor="omp"
LABEL com.docker.sandboxes.base="docker/sandbox-templates:shell-docker"

USER agent
WORKDIR /home/agent
CMD ["omp"]
