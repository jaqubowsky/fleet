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
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/local/bin/chromium

ARG PLAYWRIGHT_VERSION=1.63.0

RUN sudo -E npm install -g --prefix /usr/local/share/npm-global "playwright@$PLAYWRIGHT_VERSION" \
 && sudo -E /usr/local/share/npm-global/bin/playwright install --with-deps chromium \
 && sudo rm -rf /var/lib/apt/lists/* \
 && sudo chmod -R a+rwX "$PLAYWRIGHT_BROWSERS_PATH"

ARG AGENT_BROWSER_VERSION=0.37.1

RUN chrome="$(ls -d "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/chrome-linux*/chrome 2>/dev/null | head -1)" \
 && [ -x "$chrome" ] \
 && printf '#!/bin/sh\nexec "%s" --no-sandbox "$@"\n' "$chrome" \
    | sudo tee "$AGENT_BROWSER_EXECUTABLE_PATH" >/dev/null \
 && sudo chmod +x "$AGENT_BROWSER_EXECUTABLE_PATH" \
 && sudo npm install -g --prefix /usr/local/share/npm-global --allow-scripts=agent-browser "agent-browser@$AGENT_BROWSER_VERSION" \
 && agent-browser doctor --json

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

ARG DEFUDDLE_CLI_VERSION=0.7.0
ARG YT_DLP_VERSION=2026.08.19
ARG YT_DLP_SHA256_ARM64=b16e4dab368a816cd05d477d698a605a6ae87ccee1c8ffd38fa21d7254141fcc
ARG YT_DLP_SHA256_AMD64=58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a

RUN sudo npm install -g --prefix /usr/local/share/npm-global "defuddle-cli@$DEFUDDLE_CLI_VERSION" \
 && case "$(dpkg --print-architecture)" in \
      arm64) asset=yt-dlp_linux_aarch64; sum="$YT_DLP_SHA256_ARM64" ;; \
      amd64) asset=yt-dlp_linux; sum="$YT_DLP_SHA256_AMD64" ;; \
      *) echo "yt-dlp: unsupported architecture $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac \
 && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/$YT_DLP_VERSION/$asset" -o /tmp/yt-dlp \
 && echo "$sum  /tmp/yt-dlp" | sha256sum -c - \
 && sudo install -m 0755 /tmp/yt-dlp /usr/local/bin/yt-dlp \
 && rm -f /tmp/yt-dlp \
 && defuddle --version \
 && yt-dlp --version

RUN printf 'ignore-scripts=true\nmin-release-age=7\nsave-exact=true\n' > /home/agent/.npmrc \
 && printf 'ignore-scripts true\n' > /home/agent/.yarnrc \
 && mkdir -p /home/agent/.config/pnpm \
 && printf 'minimumReleaseAge: 10080\nblockExoticSubdeps: true\n' > /home/agent/.config/pnpm/config.yaml

ARG PI_VERSION=0.85.1

RUN sudo apt-get update \
 && sudo apt-get install -y --no-install-recommends fd-find jq \
 && sudo rm -rf /var/lib/apt/lists/* \
 && sudo ln -sf "$(command -v fdfind)" /usr/local/bin/fd \
 && sudo npm install -g --prefix /usr/local/share/npm-global "@earendil-works/pi-coding-agent@$PI_VERSION" \
 && sudo ln -sf /usr/local/share/npm-global/bin/pi /usr/local/bin/pi \
 && pi --version

RUN sudo chown -R agent:agent /home/agent/.npm

COPY --from=pi-home --chown=agent:agent agent/    /home/agent/.pi/agent/
COPY --from=pi-home --chown=agent:agent skills/   /home/agent/.pi/skills/
COPY --chown=agent:agent agent-settings.json      /home/agent/.pi/agent/settings.json

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
