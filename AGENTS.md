# Working in this repository

Every change lands in both harnesses — pi and claude — in the same ticket, not in a follow-up. A harness is left out only when its architecture makes the change inapplicable, and the ticket says why in one line.

The host's claude guard hook runs this checkout's `claude/hooks/guard.ts` and `src/guard/` afresh on every tool call, and a guard that fails to load refuses every call, including the edit that would fix it. So every save there leaves a tree that loads: add a new export before its first import, and drop an old one only after its last import is gone. Pi loads `extensions/guard.ts` once, when its session starts.
