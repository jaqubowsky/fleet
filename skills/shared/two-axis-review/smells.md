# Smell baseline

The fixed set of Fowler code smells (_Refactoring_, ch.3) the engineering-quality axis carries even when a repo documents nothing. Read by the reviewer, not by the skill that runs it.

Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation. Like any standard here, skip anything tooling already enforces.

Match the diff against each, with the book's refactoring as the fix: Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man, Refused Bequest. Duplicated Code also takes the detector's clone list, machine-found pairs that include code outside the diff.
