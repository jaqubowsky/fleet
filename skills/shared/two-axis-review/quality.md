# Quality questions

The questions the engineering-quality axis asks of every diff, after the repository's own standards. Read by the reviewer, not by the skill that runs it.

Two rules bind them:

- **The repo overrides.** A documented repo standard always wins; where it endorses what a question would flag, the question stays unasked.
- **A judgement with its cost.** A finding names a pro and a con, or a measurement, never a label standing alone. Skip what tooling already enforces.

1. **Role.** Say in one sentence, without "and", what each hook, component, function or module the diff adds or grows is for. One that needs two sentences holds two roles. For a module, delete its folder in thought and count the errors and the silent stumps left.
2. **Written once.** Each rule, constant and data shape the diff adds exists in one place, also across server and client. Share technical code, copy domain code: two copies that can change independently are two pieces of knowledge. A third copy with the same reason to change is the one to extract. The clone list holds machine-found pairs, code outside the diff included.
3. **Place.** A computation sits in a pure function with a test, outside the component or handler that calls it. A type sits beside its one consumer, or at the seam its consumers share.
4. **State.** No stored value derives from another stored value, no fact is stored twice, and no two fields can contradict each other, such as `isSending` beside `isSent`. States that exclude each other are a union, where the diff has optional fields or flags. For an entity or type the diff grows, invent a rule joining the new attribute to an old one and see whether it sounds absurd.
5. **Already there.** The repository, or a dependency it already has, does the same job: name it.
