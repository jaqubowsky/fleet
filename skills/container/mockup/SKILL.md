---
name: mockup
description: 'A mockup of a change before it is built: live pages on one board the user opens from disk, as variants to pick from, the screens of a flow or a component''s states. Use when the order asks to see a change, a screen, a flow or a component before the build.'
---

# Mockup

A mockup is a change drawn as standalone HTML pages before any production code moves. Every mockup of a task lands on one **board**, `mockup/index.html` where your seat's rules keep outputs: a canvas with each page live at its real size, one **frame** per page and size. Each mockup is one **section**: a slug, its pages in `mockup/<slug>/`, one `board({...})` call in `mockup/board.js`. A revision replaces its own pages and edits its own call.

1. **Scope.** From the order, name each region or component the change touches and the states it needs. A small change is drawn in place on today's screen, everything around it as it is. Done when every changed region has a name.
2. **Recon.** Today's look comes from the running app on this branch, else from the components' source. Colors, spacing, type and copy are the app's own tokens and strings, in the app's language. Done when every value the mockup uses traces to a token or a string in the repo.
3. **Build.** Copy `board/*` from this skill's directory into `mockup/`, overwriting; `mockup/board.js` is yours. Write each page as `mockup/<slug>/<page>.html` and add the section to `mockup/board.js` in the shape below. One variant by default; two to five when the order asks for more or leaves a visible choice open. Done when every region and state Scope named is drawn on a page and has a frame.
4. **Look.** From the directory that holds `mockup/`, run `node <skill dir>/scripts/look.mjs <slug>`. It screenshots every frame, and every `play` run, into `mockup/<slug>/shots/` and the board into `mockup/board.png`, and prints its findings and `count`. Read every screenshot for what it cannot see: a separator (`·`, `|`) opening or closing a line, a button pushed onto a line of its own, a band of dead space, text over an image it cannot be read on. Fix and run again, up to three passes. Done when it prints `count: 0` and the screenshots show none of those, or after the third pass with what remains named for the hand-over.
5. **Hand over.** Ask the section's question the way your seat's rules ask one. Name `mockup/index.html#<slug>`, one line per variant with its real downside, and any defect Look left; then end the turn. The answer is `Decided: <slug>: <id>`, recorded beside the task's other decisions, and the build follows it.

## Craft

- Variants differ on one named axis each (layout, density, wording, motion, interaction model); two that differ only in color or copy are one variant. The title names the direction, never "Option A"
- Every page works: real interactions, realistic copy, plausible names and numbers
- Motion: `transform` and `opacity` only, `ease-out` on entrances (`cubic-bezier(0.23, 1, 0.32, 1)`), under 300 ms for UI, none on actions repeated many times a day, `prefers-reduced-motion` honoured

## Gotchas

- The user opens the board straight from disk. Each page carries its own `<!doctype html>`, `<meta charset="utf-8">` and viewport meta, or non-ASCII letters arrive garbled; fonts load from Google Fonts with the app's fallback stack, everything else is inline
- Look shoots 600 ms after load: a page reaches its complete look by then. The board runs every page at once, so motion plays once and settles, never loops

## Shape

`mockup/board.js`, one call per section, in the order the mockups were made:

```js
board({
  slug: "export-button",
  title: "Export button on the orders list",
  question: "Which export button goes forward?",
  frames: [
    { id: "A", file: "A.html", title: "Icon in the toolbar", note: "Easy to miss next to the filters." },
    { id: "A", file: "A.html", size: "phone" },
    { id: "B", file: "B.html", title: "Labelled button", note: "Pushes the search field narrower on a phone.",
      play: [{ name: "open", steps: [{ click: "#export" }] }] }
  ]
});
```

A frame is one page at one `size`: `"desktop"` (1440×900, the default), `"tablet"`, `"phone"` (390×844) or `{ w, h }`; another size is another frame. `note` is the real downside of a variant, or a caption. `play` lists the interactions Look runs, each from a fresh load, screenshotted after its last step: `click`, `hover` (a selector), `fill` (`[selector, text]`), `press` (a key), `drag` (`[selector, dx, dy]`), `wait` (ms), `eval` (JS). A page with a control or motion gets one run per state it reaches.
