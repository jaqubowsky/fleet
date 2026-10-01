# Testing a document

The recipe behind Refining against runs in [`SKILL.md`](SKILL.md): how to put a wording change in front of fresh agents and read what comes back. A full run costs minutes and money per sample; a micro-test costs seconds and isolates one step, so wording is settled here and confirmed by one full run at the end.

1. **Name the failure.** Quote it from a real run: the output, the trace line, the agent's own words. A failure nobody has seen is a guess, and a document written for it adds load that buys nothing. Done when the failure is one sentence and a quote.
2. **Write the scenario.** One file holding what the agent would know at the moment it fails, stated as facts (what the code shows, what the order says), and a task that asks for the smallest output that can show the failure: a plan, a list of titles, a choice between named options. A discipline document gets the pressures from `SKILL.md` stacked into it. Done when a reader of the file alone could make the mistake.
3. **Write the score before reading anything.** A rule that marks one output pass or fail without judgement in the moment: "a variant with today's structure and the same cards fails". Add what the arms should be compared on beside it, such as how many distinct ideas each output holds. Done when two readers would mark the same output the same way.
4. **Run the arms.** A control with no document, the current document, each candidate wording, and an ablation arm, the document with the lines on trial removed, five reps each, every rep in a fresh context, on every model the document will run on:
   - Claude: one sub-agent per rep, told to read the document file and then the scenario file, to use no other tool, and to end on the asked output only. Say nothing about what is measured
   - another model through its own one-shot CLI, such as `pi -p --no-session --no-extensions --model <provider/model:level> "<same instruction>"`, the reps run in parallel and each written to its own file
5. **Read every output** and mark it with the score. Tabulate per arm and per model: the failure count, and the spread the arms are compared on.
6. **Decide** from the table:
   - the control does not fail: there is nothing to fix on that model, so stop
   - the document arm fails: change the wording, add it as a new arm, rerun
   - the document arm passes and the control fails: the wording works at this step
   - the ablation arm scores like the document: the lines it removed change nothing, so cut them
   - the micro-test passes but a full run still fails: the failure lives in a step the scenario skipped, so move the scenario to that step or reorder the steps, and test again
7. **Confirm with one full run** on the model that failed. Done when that run shows the failure gone and the arms' table is kept beside the change.
