# Babysit a pull request right after opening it

## Status

Accepted.

## Context

A container that opened a pull request ended its turn after `gh pr create`. `babysit-pr` started only when someone steered "babysit PR #n", and the README told the person to give that order. On 2026-11-03 the person asked for the babysit to start on its own whenever a container opens a pull request, since they saw no reason to skip it. In one past task, flo-2094, the babysit work took about 70 tool calls.

The host steers a container after every land with one sentence from the land line of `permissions.md`. With container push `none`, each babysit round with fixes goes back to the host to land, so that steer arrives again when the pull request is already open.

## Decision

`sbx/container/sandbox.md` Finish step 3 is the one place that orders the loop. Once the branch's pull request is open, whether the container opened it, updated it or a steer named it, the container runs `babysit-pr` round after round with no steer in between. It stops at the skill's Done or one of its exits: the third bot pass on one pattern, an obsolete pull request, or a product decision. A round the seat cannot push ends the turn for the host to land. The closing message comes at that point, not after `gh pr create`. The `babysit-pr` description triggers on a pull request the container opened, updated or was told about. What a round does is unchanged.

The steer in the land line (`src/profile/profile.ts`) reads "resync, open the PR if none is open, and babysit it". The same sentence works after the first land and after every later one, and never orders a second pull request. The host's Landing section already defers to the land line, so it stays as it is. Where the land level is `auto`, the container pushes and opens the pull request itself and no steer follows. Finish step 3 covers that case too.

## Consequences

The person no longer orders a babysit. The watch ends at Done. A human review that arrives days later still needs a steer, because nothing wakes the container for it. A turn that opens a pull request now lasts until CI settles and the bots have answered. No real container run has confirmed the new flow yet.
