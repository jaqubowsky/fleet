# Browser check

Commit: <single repo: sha7 on branch, base branch@sha7, working tree clean | status and diff hash; multiple repos: every name from repositories.json@full SHA with its dirty state>
Launch: `<command>` from `<working directory>`, answered at <URL>

## Frames

- [<file>](<file>) <route>: <criterion>: <verdict><, expected and actual when failed>

One line per frame, the route the frame shows first. A walk outside every criterion adds a line whose criterion reads `incidental`. In a regression walk the verdicts are `regressed`, `pre-existing` and `coverage-gap`, and a regressed line names the base's behaviour on the same flow.

The run passes only when every cumulative criterion has a frame that passed, and one failed frame fails it. A criterion the run could not reach or drive, with nothing failed, leaves it blocked, so the person sees what it could not prove. A later refactor alone removes no criterion.

Cleanup: browser closed, working tree <clean | what was removed>.
