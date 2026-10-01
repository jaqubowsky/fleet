# 2. Your config in `~/.config/harness/`

This repository holds nothing personal. What names the person lives in `~/.config/harness/`:

| Path | Needed | Holds |
| --- | --- | --- |
| `git/` | yes | the git config every sandbox image starts with, copied into its home as it is |
| `repos.json` | no | permissions per repository; without it every repository gets the `*` entry of `host/repos.json` |
| `projects/<owner>/<repo>.md` | no | what an agent should know about one repository, under the headings of `host/projects/template.md` |

Write these files now. Step 3 installs the guard, and from then on it refuses an agent's write here: later changes are the person's, so propose the exact content and let them save it.

## `git/.gitconfig`

Sandboxes commit unsigned and reach GitHub over HTTPS through the sbx proxy, so the file turns signing off and rewrites SSH remotes:

```ini
[user]
	name = Alice Example
	email = alice@example.com
[commit]
	gpgsign = false
[url "https://github.com/"]
	insteadOf = git@github.com:
```

Everything under `git/` lands in the sandbox home as it is, so a second file such as `git/.gitconfig-work` works when `.gitconfig` includes it. No signing key goes there.

## `repos.json`

One entry per repository or owner (`owner/*`), in the shape of `host/repos.json`. Ask the person, for each repository the agents will work on:

- may the host push and merge on its own (`host.push`, `host.merge`: `auto`), or does the person do it (`human`)?
- may the sandbox push its branch and open the pull request (`container.push`, `container.pr`)?
- are their commits signed? Most people start with `host.sign: none`; step 4 covers signing
- which GitHub token covers it? `container.token` is `keychain:<name>`, stored in step 4

`fleet profile <owner/repo>` prints what each level means for both seats. Read it to the person before they settle a repository.

## Check

`git config --file ~/.config/harness/git/.gitconfig user.email` prints the email. With a `repos.json`, `jq . ~/.config/harness/repos.json` parses it.
