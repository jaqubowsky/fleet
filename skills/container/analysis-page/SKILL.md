---
name: analysis-page
description: 'Turning a finished analysis into a page a person reads in a browser: what changes, the diagrams, the plan, what to check. Use when a turn wrote or changed an analysis.'
---

# Analysis page

The page is read top to bottom in one pass, ending on the reader's decision: what changes, the diagram, the plan, what to check, the question. Everything else stays folded. A small change fits one screen. A bigger one keeps this order and grows by what it really holds: more Plan lines, more `Check` lines, a figure per code path. Length comes from the change, so nothing it needs is cut to fit, and a detail that does not change the decision goes into a folded block.

1. **Copy.** Copy `assets/template.html` from this skill's directory to `analysis.html` beside the report's written copy, where your seat's rules keep outputs, overwriting an earlier page. The style block stays as it is.

2. **Fill.** Replace every `[[fill: ...]]` from the report, in the language of your reply, the template's headings too. Every value comes from the report, and no sentence appears that the report does not support. Repeat a line once per item, and remove a folded block with nothing to show.

   - The unfolded part holds short lines: a Plan line is the slice's title alone, one per slice, and a `Check` line is one technical choice with its reason, one per choice.
   - With a decision open the Plan is not written yet: the page keeps the heading, the sentence under it and the question block, which lists each open question with its options, the recommended one first. Remove the rest.

3. **Draw.** Redraw the template's figures for this change, as the Diagram rules below say.

4. **Check.** `grep -c '\[\[' analysis.html` prints 0. A page still holding a marker goes back to step 2.

5. **Hand over.** The reply names the page's absolute path.

## Diagram rules

- A figure shows one code path after the change, drawn with the template's classes. `Today` repeats it with every box in the same place, so the reader finds the difference by position
- A change that touches several code paths gets a figure per path, the one the decision turns on first, each under a heading naming the path
- A figure holds what the decision turns on, six boxes at most; a path that needs more splits into two figures. A box names the real function, table or endpoint
- The change is the only thing marked: `n-ch`, `e-ch` and `s-ch`, always with a word such as "new" beside the colour. A path that does not exist today is `e-no`
- Every arrow carries a verb of a word or three. A sentence goes under the figure
- Keep `viewBox` at 620 wide, with boxes on an even grid. A label that does not fit is shortened
- A flow too wide for that goes into `Call order`, which holds any length: one row per call, `ch` on a changed row with the Plan slice beside it, `tx` on the rows one transaction binds, with `tx-head` above them

## Gotchas

- The person opens the page straight from disk: everything stays inline, with no script, font or image fetched from the network
- A `<` in code or a label is written `&lt;`, or the page breaks there
