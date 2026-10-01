# Setup

This is for an agent. The person starts you in a fresh clone of this repository with "read SETUP.md and set me up" and sits beside you.

## How to work

- Do the steps below in order. Open only the current step's file; each one holds everything that step needs
- Lines starting with `Person:` are theirs: anything that needs a password, a browser, a fingerprint or a secret. Before each step, say which parts are yours and which are theirs
- When a step asks the person something, ask everything in one message, each question with the answer you recommend
- Each step ends with a check. Run it, read the output, and go on only when it passes. A failed check is the next thing to fix
- Never write a secret into this repository, a shell history or a chat. Each step names where a secret goes

## Steps

1. [Tools and logins](docs/setup/01-tools.md): requirements, sbx, herdr, Claude Code and pi, and their logins
2. [Your config](docs/setup/02-your-config.md): the sandboxes' git config and the permissions per repository in `~/.config/harness/`
3. [Sync](docs/setup/03-sync.md): install the harness for both agents and build the sandbox images
4. [GitHub tokens](docs/setup/04-github-tokens.md): one token per group of repositories, stored in the macOS keychain
5. [Model logins and network](docs/setup/05-models-and-network.md): how sandboxes reach the models, and which hosts they may reach
6. [Smoke test](docs/setup/06-smoke-test.md): start and stop one sandbox per agent
7. [First session](docs/setup/07-first-session.md): the person's first task from a herdr tab

## Done

1. A second `./sync.sh` prints `In sync: nothing to change.`
2. `npm test` and `npm run check` exit 0
3. Both smoke sandboxes came up, answered and went down
4. The host session in herdr answered and listed the repository's pull requests

Tell the person what stays theirs and where it lives: the logins (step 1), `~/.config/harness/` (step 2), the keychain tokens (step 4), and the sbx secrets and network policy (step 5).
