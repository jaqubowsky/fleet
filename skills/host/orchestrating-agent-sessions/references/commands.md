# Fleet commands

Reached from the skill before running a `{{cli}}` command: the row for the operation, and what to report from its output.

| Ask | Command | Result to report |
| --- | --- | --- |
| put up a container for a task | `{{cli}} up <label> --repo <path> [--repo <path> ...] [--pi | --claude] [--branch <name>] [--base <name> ...] [--model <model>] [--memory 8g] [--cpus 4]` | the sandbox is `<agent>-<repo>-<label>`, so `<label>` names the task alone; one repo keeps its existing setup; multiple repos use the first as primary and bring each additional repo into a private clone by Git bundle, never a writable host mount, with its git dir under the primary's `.git/fleet-repos/`; every repo gets its ignored `.env*` files. Each has its own fetched origin base, branch, profile and install log. One `--base` applies to all, or supply one per repo in `--repo` order for different bases; `--branch` names one branch in each. Report every repo, task directory and waiting tab; no prompt is sent |
| what is running | `{{cli}} ls` | status and herdr state, then the branch, dirty count and full SHA of each running repo; its commits since origin's default branch, activity and cost. Stopped containers stay listed without checkout probes. A running repo whose checkout cannot be probed shows `failed` with its name and error; other containers still list |
| release a container's resources, keep its work | `{{cli}} stop <sandbox>` | stopped, files and herdr tab kept; the watch shows `stopped` and sends no automatic continue |
| resume a stopped container | `{{cli}} start <sandbox>` | the agent in its saved tab, with its last saved session when one exists; no prompt sent |
| what is it doing this minute | `{{cli}} peek <sandbox> [--lines 40]` | each running repo's branch, dirty count, full SHA, status, log, diff and install log, then the pane tail; a stopped container shows only its saved pane, without starting it |
| send it this | `{{cli}} steer <sandbox> "<text>"` | {{steer.result}} |
| run something inside | `{{cli}} exec <sandbox> -- <command>` | command output; one quoted argument runs as a shell line, several run as argv |
| what it left | `{{cli}} artifacts [--repo <path>]` | each task's files with size and age, its folders folded to one line |
| get one file out | `{{cli}} copy <sandbox>:<path> <local>` | local path |
| bring the branch home | `{{cli}} land <sandbox> [--branch <name>] [--sign] [--push]` | the same flags for any number of repos: fetch each branch from the sandbox's git daemon, preflight every repo (clean container on the recorded branch, descends from the saved base, checked out in no host worktree) before any branch moves, then fast-forward or re-create what the container added since the `landed` ref. Bare `land` signs per profile, `--sign` forces it, `--push` also pushes, after every repo is signed. A declined signature or refused push keeps finished repos; rerun the same command. Never force. `--branch` is one-repo only |
| what may each seat do in this repository | `{{cli}} profile [<repo>] [--apply]` | the profile's level per action for host and container, one sentence each, then the repository's overlay, which containers read as `project.md`; `--apply` sets the checkout's signing, origin and branch tracking as those lines say, and prints each change |
| close it | `{{cli}} down <sandbox> [--force]` | the usage line and where the task directory stays |
| rebuild the image | `{{cli}} build [--pi | --claude]` | the docker build output, and what the image now carries |
| switch models for new containers | `{{cli}} render` after editing `<kind>/profiles/models.json` in the harness repo, `<kind>` the container's `--pi | --claude`, or`--model` on one `{{cli}} up` | containers take it after `{{cli}} build`, the host {{reload.models}} |
