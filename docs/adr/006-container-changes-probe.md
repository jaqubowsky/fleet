# Read a container's changes inside the container

## Status

Accepted.

## Context

Both pi and Claude run in private container checkouts. The person wants to inspect changes while an agent works, without opening a browser or asking the agent to run a command. The host checkout is not the container's checkout, and the container's checkout lives in the sandbox.

## Decision

`fleet patch <sandbox>` reads the changes of every checkout of the task with one probe that runs inside the running container, for pi and Claude alike. It does not mirror the checkout or write its index.

The probe compares the working tree against the merge base of HEAD and the container's origin base branch recorded by Fleet; a task without a repository manifest uses the container's origin/HEAD. It never uses the host checkout or the saved creation SHA: rebasing onto a newer main would include unrelated upstream changes. It reads existing container refs without fetching. It includes untracked, non-ignored files. A task with several repositories reads each one into one patch, each path under its repository's name, through Git's `--src-prefix` and `--dst-prefix`. A file over 4 MiB, or an untracked file that is not a regular file, shows only its `diff --git` header. The host strips control characters other than tab and newline, because the container controls the patch. Fleet checks the container's state before executing; a stopped or removed container is not read.

## Consequences

Repeated reads give successive observations, not an atomic snapshot across files while the agent writes. A stop between the state check and `sbx exec` remains a race, because `sbx exec` starts stopped containers; closing it needs an exec-if-running operation in sbx. The Changes panel of [015](015-container-checkout-in-the-panels.md) shows this patch.
