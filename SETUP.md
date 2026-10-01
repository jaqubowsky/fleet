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

Check: `git config --file ~/.config/harness/git/.gitconfig user.email` prints the email, and `ls ~/.config/harness` lists `git`.

## 4. Sync

`sync.sh` renders both harness homes (`~/.pi`, `~/.claude`), writes Claude's host settings into `~/.claude/settings.json`, links the guard hook, the status line, `fleet`, the `gh` wrapper and herdr's config, and builds both container images. The render owns whole directories and replaces them on every run: `~/.claude/rules`, `refs`, `skills` and `agents`, and `~/.pi/skills`, `agent/refs`, `agent/agents` and `agent/themes`. Anything of the person's own there is deleted, and the dry run lists each such file as `remove`. Before the first `--apply`, show the person that list and copy what they want to keep.

In `~/.claude/settings.json` it writes the keys `claude/profiles/host.json` names, with `$HOME` expanded. A list under such a key is replaced, except the hook lists under `hooks`: your own entries there, such as the one `herdr integration install claude` adds, stay beside the repository's. Keys the repository does not name stay yours, and the previous file stays as `settings.json.bak`.

Read the plan first:

```bash
./sync.sh            # prints what it would change, changes nothing
./sync.sh --apply
herdr integration install claude
herdr integration install pi
npm test && npm run check
```

Neither host agent runs in an OS sandbox: on this Mac the guard hook is the only check between the agent and a command, which is why the task work itself runs in sandboxes.

The last section of `sync.sh`, `== set up by hand`, names what it found missing and cannot install itself.

Every host session start runs `fleet profile --apply --brief` in its checkout: it sets the checkout's git config the way the repository's profile says and registers the host's Linear server, printing only what it changed. A profile that gives the container a Linear server needs it registered once by hand, since `sync.sh` cannot check sbx for it: `sbx mcp add <name> --url https://mcp.linear.app/mcp/readonly`, or `https://mcp.linear.app/mcp` where the container writes.

Check: a second `./sync.sh` ends with `In sync: nothing to change.`, `npm test` and `npm run check` exit 0, and `jq -r '.hooks.PreToolUse[0].hooks[0].command' ~/.claude/settings.json` prints a path ending in `.claude/hooks/guard.sh`.

## 5. GitHub tokens

A container gets its GitHub token from the profile of the repository it works on: `container.token` in `~/.config/harness/repos.json`, else in `host/repos.json`. `up` binds it as an sbx secret, so the container never sees the value; the sbx proxy adds it to requests to GitHub. A container reads the repositories the token sees and gets 404 on the rest.

Two forms:

- `op://<vault>/<item>/<field>`: a 1Password reference; `up` has sbx read it, and `sync.sh` asks for the `op` CLI. Prefer this one
- `env:<NAME>`: the value of that variable in the host session, which `up` refuses to start without. The token then sits in the session's environment, where any command the agent runs can print it

The repository's own `*` profile in `host/repos.json` uses `env:GH_TOKEN`. To use 1Password instead, give your `~/.config/harness/repos.json` a `*` entry with an `op://` token.

Every container a profile covers gets the same token, so scope it. Person: create a fine-grained token limited to the repositories the agents work on, with contents read, and pull requests write where the profile gives the container `pr: auto`. Where `container.push` is `auto`, `up` refuses a token that sees any private repository but that one.

The host session uses the same token without holding it. `sync.sh` links a `gh` wrapper into `~/.local/bin`, ahead of the real `gh`. It picks the profile from `--repo` or the checkout's origin, reads that profile's token from the macOS keychain, and passes it to the real `gh` for that one command. Git over HTTPS asks `gh` for credentials, so a push goes the same way. An `env:` token, or a reference not yet in the keychain, leaves `gh` to its own login.

Person: after adding or rotating an `op://` token, run `fleet tokens` in your own terminal. One 1Password unlock copies every reference into the keychain under `fleet-gh`. If your shell defines a `gh` function, such as the 1Password shell plugin's, it hides the wrapper, so skip it in agent sessions.

An agent can still use a token within its scopes, so give each token only what its repository's seats need.

Where a profile gives the host `push: auto`, the host pushes over HTTPS through that `gh`. With `push: human` the person pushes with their own key. With `sign: human`, `fleet land` signs each commit with that key, which needs `user.signingkey` in the person's git config; Claude Code takes `SSH_AUTH_SOCK` from the shell that starts it, so an SSH agent that signs must be set in that shell's profile. With no signing set up, give the profile `sign: none`.

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

Without `~/.config/sbx/credentials.yaml` every model call from a pi container is a 401, and `up` refuses to start one.

Claude containers carry their own login: person, `/login` once in the tab of the first `fleet up --claude`, which stops with that instruction. sbx keeps the login for every later container.

Leave `CLAUDE_CODE_SUBAGENT_MODEL` unset: each rendered agent names its own model, and the variable can override that (anthropics/claude-code#10993).

Check: `test -f ~/.config/sbx/credentials.yaml && echo ok` prints `ok`.

## 7. The network policy

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
