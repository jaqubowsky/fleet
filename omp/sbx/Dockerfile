# syntax=docker/dockerfile:1
FROM docker/sandbox-templates:shell-docker

ENV GIT_TERMINAL_PROMPT=0
ENV NODE_OPTIONS=--disable-warning=UNDICI-EHPA

{{toolchain}}

ARG OMP_VERSION=18.2.8
ARG OMP_SHA256_ARM64=a9aa63e43c95ccaa0683e9fed03463c401829e220ad2bbc414b341d2d49e5806
ARG OMP_SHA256_AMD64=b0c01da7339d87fd5d26d7faa7b61c131a50648399962783899fd93a6d8b1d65

RUN case "$(dpkg --print-architecture)" in \
      arm64) asset=omp-linux-arm64; sum="$OMP_SHA256_ARM64" ;; \
      amd64) asset=omp-linux-x64; sum="$OMP_SHA256_AMD64" ;; \
      *) echo "omp: unsupported architecture $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac \
 && curl -fsSL "https://github.com/can1357/oh-my-pi/releases/download/v${OMP_VERSION}/${asset}" -o /tmp/omp \
 && echo "$sum  /tmp/omp" | sha256sum -c - \
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
