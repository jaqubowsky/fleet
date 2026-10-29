# Working in this repository

Every change lands in both harnesses — pi and claude — in the same ticket, not in a follow-up. A harness is left out only when its architecture makes the change inapplicable, and the ticket says why in one line.

A new skill, or a change to a rule or a skill, is placed in the whole workflow before its first edit: the seat and the rounds that run it, every rule, skill and checks table that names it or the step beside it (`rg -l '<skill or step name>' rules skills sbx`), and any skill whose job it overlaps, such as a review beside a cleanup pass. The hand-over names each of those files with what changed there, or why nothing had to, and the order the steps of an affected round now run in.

The host's claude guard hook runs this checkout's `claude/hooks/guard.ts` and `src/guard/` afresh on every tool call, and a guard that fails to load refuses every call, including the edit that would fix it. So every save there leaves a tree that loads: add a new export before its first import, and drop an old one only after its last import is gone. Pi loads `extensions/guard.ts` once, when its session starts.
