# 7. The first real session

The host agent works from a Herdr app tab, and `fleet up` and `fleet start` open each sandbox's tab in the same window. `fleet watch` follows the sandboxes the host session started or steered.

Person:

1. Start Herdr app and open a tab in the clone of a repository from step 2
2. Run plain `claude` or `pi`, whichever is installed, there, with no token in front. As it starts it applies the repository's profile to the checkout and reports anything it changed
3. Give it a task: plain words, a Linear issue, or a markdown file

## Check

The host answers, and `gh pr list` in that tab lists the repository's pull requests without asking for a login. If it asks, the repository's token is missing: step 4.
