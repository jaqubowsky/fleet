# syntax=docker/dockerfile:1
FROM docker/sandbox-templates:shell-docker

ENV GIT_TERMINAL_PROMPT=0
ENV NODE_OPTIONS=--disable-warning=UNDICI-EHPA

ARG NODE_MAJOR=24
ARG NODE_VERSION=24.20.0-1nodesource1
ARG NODESOURCE_GPG_SHA256=7a96b125f721c99e07d3f45b279adbd6884ec4f3f06750f6b54df40cfae36836
ARG NPM_VERSION=12.0.2
ARG TYPESCRIPT_VERSION=7.0.2
ARG TS_LANGUAGE_SERVER_VERSION=6.0.0

RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o /tmp/nodesource.key \
 && gpg --dearmor < /tmp/nodesource.key > /tmp/nodesource.gpg \
 && echo "$NODESOURCE_GPG_SHA256  /tmp/nodesource.gpg" | sha256sum -c - \
 && sudo install -m 0644 /tmp/nodesource.gpg /usr/share/keyrings/nodesource.gpg \
 && printf 'Types: deb\nURIs: https://deb.nodesource.com/node_%s.x\nSuites: nodistro\nComponents: main\nArchitectures: %s\nSigned-By: /usr/share/keyrings/nodesource.gpg\n' \
      "$NODE_MAJOR" "$(dpkg --print-architecture)" \
    | sudo tee /etc/apt/sources.list.d/nodesource.sources >/dev/null \
 && sudo apt-get update \
 && sudo apt-get install -y "nodejs=$NODE_VERSION" \
 && rm -f /tmp/nodesource.key /tmp/nodesource.gpg \
 && sudo npm install -g --prefix /usr/local/share/npm-global \
      "npm@$NPM_VERSION" "typescript@$TYPESCRIPT_VERSION" "typescript-language-server@$TS_LANGUAGE_SERVER_VERSION" \
 && sudo corepack enable

ENV FNM_DIR=/home/agent/.fnm
ENV FNM_VERSION_FILE_STRATEGY=recursive
ENV FNM_RESOLVE_ENGINES=true
ENV FNM_COREPACK_ENABLED=true

ARG FNM_VERSION=v1.39.0
ARG FNM_SHA256_ARM64=4eaff58b2c5bf30d0934027572dd0b5bbb60d2a1af309230b53662d4b1d45599
ARG FNM_SHA256_AMD64=7807664f39d39fc518da1c35ba0181e4b3267603c4b1dedeb4b5fc6ae440a224

RUN case "$(dpkg --print-architecture)" in \
      arm64) asset=fnm-arm64.zip; sum="$FNM_SHA256_ARM64" ;; \
      amd64) asset=fnm-linux.zip; sum="$FNM_SHA256_AMD64" ;; \
      *) echo "fnm: unsupported architecture $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac \
 && curl -fsSL "https://github.com/Schniz/fnm/releases/download/$FNM_VERSION/$asset" -o /tmp/fnm.zip \
 && echo "$sum  /tmp/fnm.zip" | sha256sum -c - \
 && sudo unzip -qo /tmp/fnm.zip fnm -d /usr/local/bin \
 && sudo chmod a+rx /usr/local/bin/fnm \
 && rm /tmp/fnm.zip \
 && printf '\neval "$(fnm env --use-on-cd --shell bash)"\n' >> /home/agent/.bashrc \
 && fnm --version

ENV PLAYWRIGHT_BROWSERS_PATH=/usr/local/share/ms-playwright

ARG PLAYWRIGHT_CLI_VERSION=0.1.20

RUN sudo npm install -g --prefix /usr/local/share/npm-global "@playwright/cli@$PLAYWRIGHT_CLI_VERSION" \
 && sudo -E /usr/local/share/npm-global/bin/playwright-cli install-browser --with-deps chromium \
 && sudo rm -rf /var/lib/apt/lists/* \
 && sudo chmod -R a+rwX "$PLAYWRIGHT_BROWSERS_PATH" \
 && sudo chown -R agent:agent /home/agent/.cache

RUN sudo ln -sf "$PLAYWRIGHT_BROWSERS_PATH"/ffmpeg-*/ffmpeg-linux /usr/local/bin/ffmpeg \
 && sudo ln -sf /usr/local/share/npm-global/lib/node_modules/@playwright/cli/node_modules/playwright-core/cli.js /usr/local/bin/playwright-core \
 && ffmpeg -hide_banner -version | head -1 \
 && playwright-core --version

RUN printf '{"outputDir":"/tmp/playwright-cli","browser":{"browserName":"chromium"}}' \
    | sudo tee /etc/playwright-cli.json >/dev/null \
 && PLAYWRIGHT_MCP_CONFIG=/etc/playwright-cli.json playwright-cli open about:blank \
 && playwright-cli close \
 && test -d /tmp/playwright-cli \
 && rm -rf /tmp/playwright-cli

ENV PLAYWRIGHT_MCP_CONFIG=/etc/playwright-cli.json

RUN printf '%s\n' \
      'case ":$PATH:" in' \
      '  *":${FNM_MULTISHELL_PATH:-/nonexistent}/bin:"*) ;;' \
      '  *) if [ -d "${FNM_MULTISHELL_PATH:-/nonexistent}/bin" ]; then' \
      '       PATH="$FNM_MULTISHELL_PATH/bin:$PATH"; export PATH' \
      '     else' \
      '       eval "$(fnm env --shell bash)"' \
      '     fi ;;' \
      'esac' \
      'fnm use --install-if-missing --silent-if-unchanged >/dev/null 2>&1 || true' \
      'fnm use --silent-if-unchanged >/dev/null 2>&1 || true' \
      '[ -r /etc/sandbox-persistent.sh ] && . /etc/sandbox-persistent.sh 2>/dev/null || true' \
    | sudo tee /etc/fnm-bash-env.sh >/dev/null \
 && sudo chmod a+r /etc/fnm-bash-env.sh

ENV BASH_ENV=/etc/fnm-bash-env.sh

ARG JSCPD_VERSION=5.2.0

RUN sudo npm install -g --prefix /usr/local/share/npm-global "jscpd@$JSCPD_VERSION" \
 && jscpd --version

RUN printf 'ignore-scripts=true\nmin-release-age=7\nsave-exact=true\n' > /home/agent/.npmrc \
 && printf 'ignore-scripts true\n' > /home/agent/.yarnrc \
 && mkdir -p /home/agent/.config/pnpm \
 && printf 'minimumReleaseAge: 10080\nblockExoticSubdeps: true\n' > /home/agent/.config/pnpm/config.yaml

ARG OMP_VERSION=18.2.8
ARG OMP_SHA256_ARM64=a9aa63e43c95ccaa0683e9fed03463c401829e220ad2bbc414b341d2d49e5806
ARG OMP_SHA256_AMD64=b0c01da7339d87fd5d26d7faa7b61c131a50648399962783899fd93a6d8b1d65

RUN sudo apt-get update \
 && sudo apt-get install -y --no-install-recommends fd-find jq \
 && sudo rm -rf /var/lib/apt/lists/* \
 && sudo ln -sf "$(command -v fdfind)" /usr/local/bin/fd \
 && case "$(dpkg --print-architecture)" in \
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
