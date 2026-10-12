# Reading a task

Reached from the skill for a question about a task: the one file that answers it, and where a multi-repository task keeps its clones.

| Question | Read |
| --- | --- |
| where is it, does it need anyone | its last closing message: the wake, or `{{cli}} peek` |
| what happened, in order | `git log` in the container; each turn's closing message is in the session transcripts under `logs/sessions/` |
| which commits | `{{cli}} ls` for each repo's branch, dirty count and full SHA; `repositories.json` records each repo's base and branch, `refs/fleet/<sandbox>/<repo>/landed` in the host repo is the container head last landed, and `git log <base>..<branch>` shows the host history after land |
| what did the analysis find | `analysis.md` |
| what did the reviewer find, which checks ran with which exit | `review.md`; its `Range:` is what it covered. The checks table of the closing message names each check, its result, the commit it passed on and its log |
| what is happening on the PR | the pull request on GitHub, and the closing message of the container's last round |
| how will it look | open <task dir>/mockup/index.html#<slug> on the Mac, the slug from the closing message; the user's pick goes back as a steer naming the slug and the variant |
| what is it doing this minute | `{{cli}} peek` |
| why did that test fail, what exactly was said | the file under `logs/` that one of the above points at |

Every repository is a private clone. `repositories.json` names all additional clones built from Git bundles inside the sandbox, their git dirs under the primary's `.git/fleet-repos/`; no additional host checkout is mounted writable. Writes stay there until `{{cli}} land`; multi-repository container pushes are refused and require an approved host push. Configure each repo's own profile. The shared sandbox needs identical `container.token`, `container.linear` and `container.linearServer` bindings; the token must access every repo. Incompatible bindings refuse creation. Two host directories are mounted alongside it at the same absolute path inside as outside: `$FLEET_ARTIFACTS`, the primary repository's `~/.fleet/tasks/<repo>` (or the `groups/` root an older task recorded), with one task directory per container and `runbook/`; and `$FLEET_CACHE` for what is expensive to rebuild. A multi-repository task also mounts each other repository's `~/.fleet/tasks/<repo>/runbook`, writable, which `{{cli}} up` creates when missing. They outlive the container, so `{{cli}} down` leaves the task directory, its sessions and `logs/usage.json` behind.
