# Setup

For an agent the reader starts in a fresh clone of this repository with "read SETUP.md and set me up". The person sits beside you. They do everything that needs a password, a browser, a fingerprint or a secret; you do the rest and say which is which before each step.

Work in order. Each step ends with a check. Run it, read its output, and move on only when it passes. A failed check is the next thing to fix, not a note for later. Never write a secret into this repository, a shell history or a chat: secrets go into the store each step names.

## 0. Requirements

Check all of them before step 1 and report the full list, passed and missing, in one message.

| Requirement | Check | Where it comes from |
| --- | --- | --- |
| macOS 14 or newer on Apple Silicon | `sw_vers -productVersion` prints 14 or higher, `uname -m` prints `arm64` | sbx runs nowhere else |
| Homebrew | `command -v brew` | brew.sh |
| git, jq, python3, gh | `command -v git jq python3 gh` prints four paths | `brew install jq gh`; git and python3 ship with the Xcode command line tools |
| Node 22.19 or newer | `node --version` | pi's floor; this repository is tested on Node 24 |
| A Docker account | the person has one | sbx signs in with it |
| A GitHub token for containers | the person can create a fine-grained token | step 5 |

`sync.sh` names what it finds missing under `== set up by hand`. Missing items: propose the install command, and let the person run anything that asks for a password.

## 1. Tools

```bash
brew trust docker/tap && brew install docker/tap/sbx    # Docker Sandboxes, free locally
brew install herdr                                      # terminal workspace the agents run in
npm install -g @earendil-works/pi-coding-agent          # pi
curl -fsSL https://claude.ai/install.sh | bash          # Claude Code, updates itself
```

Person: start `sbx` once and sign in with the Docker account when it asks.

Check: `command -v sbx herdr pi claude` prints four paths, and `sbx ls` answers without an authentication error.

## 2. Logins on this Mac

Person:

- Claude Code: start `claude` once and log in. Then, inside it, install the TypeScript LSP plugin from `claude-plugins-official` (`/plugin`). The Claude image copies that plugin from `~/.claude/plugins/`, so `fleet build --claude` fails without it
- pi: start `pi` and run `/login` for the provider its seats name in `pi/profiles/models.json`. It writes `~/.pi/agent/auth.json`; that file never goes into git

Check: `test -f ~/.pi/agent/auth.json && test -d ~/.claude/plugins/cache/claude-plugins-official/typescript-lsp && echo ok` prints `ok`.

## 3. Your own config: `~/.config/harness/`

This repository holds no personal value. Everything that names you lives in `~/.config/harness/`, which agents read and the guard refuses to write:

| Path | Needed | What it holds |
| --- | --- | --- |
| `git/` | yes | the git config every container image starts with, copied into the image home as it is |
| `repos.json` | no | your repository permission profiles; without it every repository gets the `*` of `host/repos.json` |
| `projects/<owner>/<repo>.md` | no | what an agent needs to know about one repository; headings in `host/projects/template.md` |

Write `git/.gitconfig` with the person's name and email. Containers commit unsigned and reach GitHub over HTTPS through the sbx proxy, so the file turns signing off and rewrites SSH remotes:

```ini
[user]
	name = Alice Example
	email = alice@example.com
[commit]
	gpgsign = false
[url "https://github.com/"]
	insteadOf = git@github.com:
```

Everything under `git/` lands in `/home/agent/` as it is: `git/.config/git/allowed_signers` becomes `/home/agent/.config/git/allowed_signers`, and a second file such as `git/.gitconfig-work` works when `.gitconfig` includes it. No signing key goes there.

`sync.sh` writes the keys `claude/profiles/host.json` names into `~/.claude/settings.json`, with `$HOME` expanded, on every run. A list under such a key is replaced, except the hook lists under `hooks`: there your own entries, such as the one `herdr integration install claude` adds, stay, and the repository's hooks are added or brought up to date beside them. The previous file stays as `settings.json.bak`. Keys the repository does not name stay yours. Claude Code takes `SSH_AUTH_SOCK` from the shell that starts it, so the SSH agent that signs on this Mac is set in that shell's profile.

Check: `git config --file ~/.config/harness/git/.gitconfig user.email` prints the email, and `ls ~/.config/harness` lists `git`.

## 4. Sync

`sync.sh` renders both harness homes (`~/.pi`, `~/.claude`), writes Claude's host settings into `~/.claude/settings.json`, links the guard hook, the status line, `fleet`, the `gh` wrapper and herdr's config, and builds both container images. The render owns whole directories and replaces them on every run: `~/.claude/rules`, `refs`, `skills` and `agents`, and `~/.pi/skills`, `agent/refs`, `agent/agents` and `agent/themes`. Anything of the person's own there is deleted, and the dry run lists each such file as `remove`. Before the first `--apply`, show the person that list and copy what they want to keep. Read the plan first:

```bash
./sync.sh            # prints what it would change, changes nothing
./sync.sh --apply
herdr integration install claude
herdr integration install pi
npm test && npm run check
```

Neither host agent runs in an OS sandbox: on this Mac the guard hook is the only check between the agent and a command, which is why the task work itself runs in sandboxes.

The last section of `sync.sh`, `== set up by hand`, names what it found missing and cannot install itself.

A profile that names a Linear server needs it registered once, which no check from this Mac can confirm. For a container seat: `sbx mcp add <name> --url https://mcp.linear.app/mcp/readonly`, or `https://mcp.linear.app/mcp` where the container writes. For the host seat, every host session start runs `fleet profile --apply --brief` in its checkout, which registers the server for both agents and prints only what it changed.

Check: a second `./sync.sh` ends with `In sync: nothing to change.`, `npm test` and `npm run check` exit 0, and `jq -r '.hooks.PreToolUse[0].hooks[0].command' ~/.claude/settings.json` prints a path ending in `.claude/hooks/guard.sh`.

## 5. GitHub tokens

A container gets its GitHub token from the profile of the repository it works on: `container.token` in `~/.config/harness/repos.json`, else in `host/repos.json`. `up` binds it as an sbx secret, so the container never sees the value; the sbx proxy adds it to requests to GitHub. A container reads the repositories the token sees and gets 404 on the rest.

Two forms:

- `env:<NAME>`: the value of that variable in the host session. The `*` profile uses `env:GH_TOKEN`, so start the host session with it set. `up` refuses before creating anything when the variable is missing. The token then sits in the session's environment, where any command the agent runs can print it, so prefer `op://`
- `op://<vault>/<item>/<field>`: a 1Password reference; `up` has sbx read it. `sync.sh` then asks for the `op` CLI

Every container a profile covers gets the same token, so scope it. Person: create a fine-grained token limited to the repositories the agents work on, with contents read, and pull requests write where the profile gives the container `pr: auto`. Where `container.push` is `auto`, `up` refuses a token that sees any private repository but that one.

The host session uses the same token without holding it. The `gh` that `sync.sh` links into `~/.local/bin`, ahead of the real one, picks the profile from `--repo` or the checkout's origin, reads its token from the macOS keychain and hands it to the real `gh` for that one process; git over HTTPS reaches it through `gh auth git-credential`. Person: after adding or rotating an `op://` token, run `fleet tokens` in your own terminal; one 1Password unlock copies every reference into the keychain under `fleet-gh`. An `env:` token, or a reference not yet copied, leaves `gh` to its own login. A shell function named `gh`, such as the 1Password shell plugin's, shadows the wrapper, so keep it out of agent sessions. An agent can still use a token within its scopes: scope each to what its repository's seats need.

Where a profile gives the host `push: auto`, the host session pushes over HTTPS through that `gh`: `fleet profile <checkout> --apply` sets the checkout up for it, and every host session start runs it with `--brief` on its own checkout. With `push: human` the person pushes with their own key, and with `sign: human` `fleet land` signs each commit through it, which needs `user.signingkey` in the person's git config. With no signing set up, give the profile `sign: none`.

Check: `fleet profile <a checkout>` prints what each seat may do there, and the token line names the form you chose.

## 6. Model credentials in sandboxes

Each harness reads one seat per role from `<harness>/profiles/models.json`: a `<provider>/<model>` and a thinking level. `up --model` overrides it for one container.

pi containers never log in. sbx stores the login on this Mac and the proxy swaps a placeholder for it:

```bash
sbx secret set openai --oauth        # person: completes the browser login
sbx secret set openrouter            # only when a seat uses openrouter; person pastes the key
mkdir -p ~/.config/sbx
printf 'bindings:\n  openai:\n    oauth:\n      domains:\n        - auth.openai.com\n        - chatgpt.com\n' > ~/.config/sbx/credentials.yaml
```

Without `~/.config/sbx/credentials.yaml` every model call from a pi container is a 401, and `up` refuses to start one. `up` builds a JWT-shaped sentinel carrying the ChatGPT account id from `~/.pi/agent/auth.json` (`src/fleet/codex.ts`); the proxy swaps it for the real bearer on the way to `chatgpt.com`. Both providers' hosts are already allowed in `pi/kits/pi/spec.yaml`.

Claude containers carry their own login: person, `/login` once in the tab of the first `fleet up --claude`, which stops with that instruction. sbx keeps the login for every later container.

`CLAUDE_CODE_SUBAGENT_MODEL` stays unset. The docs say an agent definition's `model` wins over it, but anthropics/claude-code#10993 reports the variable overriding the frontmatter. Unset is the only state where both readings agree, and each rendered agent carries its seat as `model` and `effort` frontmatter.

Check: `test -f ~/.config/sbx/credentials.yaml && echo ok` prints `ok`.

## 7. Context7 and the network policy

Context7 gives agents library docs. A container never sees its key: a custom sbx secret puts a placeholder in `CONTEXT7_API_KEY`, and the proxy swaps it on the way to `mcp.context7.com`.

```bash
sbx secret set-custom --host mcp.context7.com --env CONTEXT7_API_KEY --value '<key>'   # person
```

pi containers read the placeholder from the environment. The Claude image carries it in `claude/profiles/sbx.json` under `managedMcpServers.context7`: put the placeholder the command printed there and run `fleet build --claude`. Rotating the key changes the placeholder, so repeat both. Without Context7, delete that entry.

sbx keeps one network allowlist for every sandbox on this Mac, in its own state, not in this repository. `sbx policy inspect local-policy` prints it. Allow a host once with `sbx policy allow network <host>`; pi's `web_search` needs `mcp.exa.ai`. Which hosts every sandbox may reach is the person's call: name each one before adding it.

`sbx <command> --help` is the authority on flags; a wrong flag binds a secret to the wrong scope without an error.

Check: `sbx policy inspect local-policy` lists every host you added.

## 8. Smoke test

A host session sets `FLEET_SEAT` itself; a plain shell names one. Use a small repository the token can read:

```bash
export FLEET_SEAT=pi
fleet build --pi     && fleet up smoke --pi --repo <small repo>     && fleet down pi-<repo>-smoke
fleet build --claude && fleet up smoke --claude --repo <small repo> && fleet down claude-<repo>-smoke
```

Person: before each `down`, open the herdr tab `up` created and send the agent one message.

Check: each agent answered in its tab, `fleet ls` lists no container afterwards, and `ls ~/.sandboxes/<repo>/` still holds both task directories.

## Done

1. A second `./sync.sh` prints `In sync: nothing to change.`
2. `npm test` and `npm run check` exit 0
3. Both smoke containers came up, answered and went down

Tell the person what stayed manual and where it lives: the logins (step 2), the tokens (step 5), the sbx secrets and policy (steps 6 and 7).
