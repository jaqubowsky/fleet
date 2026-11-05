---
name: analysis-page
description: 'Turning a finished analysis into a page a person reads in a browser: what changes, the diagrams, the plan, the technical choices. Use when a turn wrote or changed an analysis.'
---

# Analysis page

The page is read top to bottom in one pass: what the change does, what changes, the plan, the technical choices, then any open question. The rest stays folded under `Szczegóły`. Length comes from the change, so nothing it needs is cut to fit, and a detail that does not change the reader's decision goes into a folded block.

1. **Copy.** Copy `assets/template.html` from this skill's directory to `analysis.html` beside the report's written copy, where your seat's rules keep outputs, overwriting an earlier page. The style block stays as it is.

2. **Fill.** Replace every `[[fill: ...]]` from the report, in Polish, whatever language the report and your reply are in. The template's headings and labels are Polish already, and this page is the one written file that is not English. Names from the code stay as the code spells them. Every value comes from the report, and no sentence appears that the report does not support. Repeat a row, card or block once per item, and remove a block or section with nothing to show.

   - A sign and a colour carry a status, so the words beside them say what the thing is. Mark a row or box `add`, `chg` or `del`, its text opening with `+`, `~` or `−`.
   - `Co się zmienia` holds one block per kind in the report's `What changes`: the table figure for a database, a `diff` table for any other kind.
   - The `Ekran` block exists when a mockup does: a screenshot from `mockup/<slug>/shots/` and the link to `mockup/index.html#<slug>`. Without a mockup, remove it.
   - `Plan` holds one card per slice. A criterion appears as its words, since a criterion's number means nothing on this page.
   - `Wybory techniczne` holds one block per choice, with the report's problem, mechanism, option turned down and lesson.
   - With a decision open the report has no Plan: keep the heading, the sentence under it, `Otwarte pytania` with every question, its recommended option first, and `Szczegóły`. With none open, remove `Otwarte pytania`.

3. **Draw.** Redraw the template's figures for this change, as the Diagram rules below say.

4. **Check.** `grep -c '\[\[' analysis.html` prints 0. A page still holding a marker goes back to step 2.

5. **Hand over.** The reply names the page's absolute path.

## Diagram rules

- The first figure shows one code path after the change. `Dziś, dla porównania` repeats it with every box in the same place, so the reader finds the difference by position
- A change that touches several code paths gets a figure per path, the one the decision turns on first, each under a heading naming the path
- A figure holds what the decision turns on, six boxes at most; a path that needs more splits into two figures. A box names the real function, table or endpoint
- Marking: `f-add`, `f-chg` or `f-del` on a box or row, with `t-on`, `s-on` and `m-on` text; `e-add` and `s-add` on a new arrow. A path that does not exist today is `e-no`
- Every arrow carries a verb of a word or three. A sentence goes under the figure
- The table figure has a box per touched table, with the columns the change needs and every changed column. A new index on an existing column is a `~` row with `IDX` at its end, and the sentence under the figure names the query it serves
- The Plan figure has a box per slice and an arrow per `Waits for`, and grows taller with the Plan. A Plan of one slice has no figure
- `viewBox` is 672 wide, 640 inside `Szczegóły`, so a figure's text stays the size of the page's text. The drawing starts at x 1, ends one short of the width, and the `viewBox` height crops to it. A label that does not fit is shortened
- A flow too wide for a figure goes into `Kolejność wywołań`, which holds any length: one row per call in groups under an `h4`, `add` on a new row with the Plan slice beside it, `tx` on the list one transaction binds

## Gotchas

- The person opens the page straight from disk: everything stays inline or beside the page, with no script, font or image fetched from the network
- A `<` in code or a label is written `&lt;`, or the page breaks there
