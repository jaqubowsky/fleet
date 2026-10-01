# 7. The first real session

The host agent works from a herdr tab. `fleet watch` follows the sandboxes its own herdr tab started or steered, so a host session outside herdr never wakes when a sandbox needs it.

Person:

1. Start `herdr` and open a tab in the checkout of a repository from step 2
2. Run plain `claude` or `pi` there, with no token in front. As it starts it applies the repository's profile to the checkout and reports anything it changed
3. Give it a task: plain words, a Linear issue, or a markdown file

## Check

The host answers, and `gh pr list` in that tab lists the repository's pull requests without asking for a login.
