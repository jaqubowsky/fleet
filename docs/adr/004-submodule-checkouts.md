# Seed submodules from the container branch's recorded commits

## Status

Accepted.

## Context

FLO-1851 and FLO-1885 inherited a submodule checkout that differed from the parent repository's gitlink. Task implementations left this unrelated difference untouched. Fleet land then refused the dirty checkout, requiring another host decision and container command.

## Decision

For pi and Claude, seed submodules after selecting the container branch. Keep copying the host's available Git objects, but check out the commit recorded by the container's parent repository. Perform this only in the newly created private clone, without force or a submodule fetch. Refuse startup if the copied submodule has local changes or its recorded commit is unavailable.

Leave the host checkout and existing containers unchanged. Keep fleet land's clean-tree requirement.

## Consequences

A clean host submodule can be on a different commit without making the new container dirty. Local edits and missing commits block startup rather than failing at land. They require a host decision before another startup attempt. The initial alignment does not repair drift introduced later by a task or a branch update.
