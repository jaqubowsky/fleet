# Wake on every new closing message, and on work that says nothing new

## Status

Accepted. Replaces the third-wake rule of [007](007-state-from-herdr.md).

## Context

The audit of 2026-10-20 matched every turn end in 12 containers against the host's wakes over two days. Six turn ends never reached the host. Each came after two `done` wakes since the last steer, and the watch dropped any third wake about the same state between steers, whatever its message. A container ending a turn to wait on a background job ("waiting on the typecheck") spent those two wakes, and its real closing message stayed silent: two requests to push, a staging result and a merged pull request. In four of the six the person asked the host what happened, up to 47 minutes later.

The same sessions held 31 `working <n>m without settling` wakes, counted on the wall clock. The host answered each with a status line while the containers' messages showed the work moving. On 2026-10-20 the Mac slept for three hours on battery. The first tick after it woke reported a container as working 228 minutes, and the host interrupted a reviewer that was not stuck.

## Decision

For pi and Claude alike, in `src/fleet/watch.ts`:

- Every settle whose message differs from the last wake about that container wakes the host. An `idle` or `done` whose message the last wake already carried stays silent between steers, as before.
- A container working 20 minutes without settling wakes the host unless its last message is new since the last wake about it; a container no wake has reached yet wakes at 20 minutes. After that check, each 15 minutes in which its message stays the same wakes the host.
- When the stall tick finds more than five minutes missing since the previous tick, the Mac slept. The watch moves the working time of every container that held its state across the gap past it and wakes the host once, naming the ones that were working, because a command they ran across it may have timed out. A container whose state changed after the Mac woke keeps the time of that change.

## Consequences

Over the audit's two days the host would have had six more wakes than its 132. A container that alternates two different messages wakes the host each time; nothing caps it. A `working` wake carries the last thing the container said, which can be old, so the host peeks before answering it. A blocked event loop longer than five minutes would read as a sleep: the monotonic clock Node uses on this Mac keeps counting through sleep (1 038 341 s against 1 038 334 s of wall time since boot, across 70 sleeps), so it cannot tell the two apart.

A long command that prints nothing to the transcript, such as a full e2e run, wakes the host after 20 minutes like a hang does. The watch cannot tell them apart; the peek can.
