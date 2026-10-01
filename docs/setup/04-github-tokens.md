# 4. GitHub tokens

Each repository's profile names its token in `container.token`. Sandboxes and the host session both use it, and neither holds the value:

- a sandbox gets it from sbx, which reads the keychain when the sandbox needs it and adds it to requests to GitHub
- the host gets it from the `gh` wrapper step 3 linked into `~/.local/bin`: for each command it finds the repository, reads that profile's token from the keychain and passes it to the real `gh` for that one command. Git over HTTPS asks `gh` for credentials, so pushes go the same way

## Token forms

- `keychain:<name>`: a macOS keychain item the person stores. Lowercase letters, digits and hyphens; several repositories may share one name. Use this one
- `env:<NAME>`: a variable the host session must be started with. It then sits in the session's environment, where any command can print it

The repository's own `*` entry in `host/repos.json` uses `env:GH_TOKEN`. To use the keychain for every repository, give the person's `repos.json` a `*` entry with a `keychain:<name>` token.

## Create and store

Person, for each token name the profiles use:

1. Create a fine-grained token on GitHub, limited to the repositories it covers: contents read, and pull requests write where the profile gives the sandbox `pr: auto`. Where `container.push` is `auto`, `fleet up` refuses a token that sees any other private repository
2. In their own terminal, run `fleet tokens set <name>` and paste it. It reads the token with echo off and stores it in the keychain, so it lands in no argument list and no shell history. After rotating a token, run it again with the same name

The guard refuses `fleet tokens` to agents. An agent can still use a token within its scopes, so give each only what its repositories need.

## Gotcha

A shell function named `gh`, such as the one the 1Password shell plugin defines, hides the wrapper. Keep it out of agent sessions, or remove it.

## Signing

With `host.sign: human`, `fleet land` signs each commit with the person's key, one Touch ID tap each. That needs `user.signingkey` in their git config and an SSH agent that signs, set in the profile of the shell that starts Claude Code. Without signing, `host.sign: none` changes nothing else.

## Check

`./sync.sh` names no `missing keychain token` under `== set up by hand`. Person: `fleet tokens` lists each `keychain:<name>` as stored.
