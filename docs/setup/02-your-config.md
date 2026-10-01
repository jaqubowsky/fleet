# 2. Your config in `~/.config/harness/`

This repository holds nothing personal. What names the person lives in `~/.config/harness/`:

| Path | Needed | Holds |
| --- | --- | --- |
| `git/` | yes | the git config every sandbox image starts with, copied into its home as it is |
| `repos.json` | no | permissions per repository; without it every repository gets the `*` entry of `host/repos.json` |
| `projects/<owner>/<repo>.md` | no | what an agent should know about one repository, under the headings of `host/projects/template.md` |

Finish this step before step 3. Step 3 installs the guard, and from then on it refuses an agent's write here: later changes are the person's, so you propose the exact content and they save it.

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

## The repositories

Ask the person which repositories the agents will work on. Each needs a local clone, anywhere on the Mac; clone the ones missing with `git clone`. Steps 6 and 7 use one of them, so ask which is the smallest.

## `repos.json`

Skip this file to try one repository first: every repository then gets the `*` entry of `host/repos.json`, where the person pushes and merges and the token comes from `GH_TOKEN` (step 4).

Otherwise write one entry per repository or owner (`owner/*`), in the shape of `host/repos.json`. Ask the person, for each repository:

- may the host push and merge on its own (`host.push`, `host.merge`: `auto`), or does the person do it (`human`)?
- may the sandbox push its branch and open the pull request (`container.push`, `container.pr`)?
- are their commits signed? Most people start with `host.sign: none`; step 4 covers signing
- which GitHub token covers it? `container.token` is `keychain:<name>`, any name they like, such as the owner's; step 4 stores the token under it

`./bin/fleet profile <owner/repo>`, run in this repository since `fleet` reaches `PATH` only in step 3, prints what each level means for both seats. Read it to the person before they settle a repository.

## Check

`git config --file ~/.config/harness/git/.gitconfig user.email` prints the email, each chosen repository has a clone, and with a `repos.json`, `./bin/fleet profile <owner/repo>` prints its levels for one of them.
