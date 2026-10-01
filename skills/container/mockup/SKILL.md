---
name: mockup
description: "A mockup of a change before it is built: live pages on one board the user opens from disk, as variants to pick from, the screens of a flow or a component's states. Use when the order asks to see a change, a screen, a flow or a component before the build."
---

# Mockup

A mockup is a change drawn as standalone HTML pages before any production code moves. Every mockup of a task lands on one **board**, `mockup/index.html` where your seat's rules keep outputs: a canvas with each page live at its real size, one **frame** per page and size. A mockup is one or more **sections**, stacked down the board in reading order: a section groups the frames that belong together (one step of a flow, one component's states) under its title, numbered when the mockup has several, and is one `board({...})` call in `mockup/board.js` with its own slug and its pages in `mockup/<slug>/`. A revision replaces its own pages and edits its own calls.

1. **Scope.** Draw what the order asks for and nothing around it: a button is a button alone in its frame, a page is the whole page. Name it and the states it needs. Done when every state has a name.
2. **Recon.** Today's look comes from the running app on this branch, else from the components' source. Colors, spacing, type and copy are the app's own tokens and strings, in the app's language, and every page follows {{refs.design}}. Done when every value the mockup uses traces to a token or a string in the repo, and every element to a component or the kin it follows.
3. **Build.** Copy `board/*` from this skill's directory into `mockup/`, overwriting; `mockup/board.js` is yours. Write each page as `mockup/<slug>/<page>.html` and add its sections to `mockup/board.js` in the shape below. One variant by default; two to five when the order asks for more or leaves a visible choice open. A component's kinds and states share one page, side by side, so one frame shows them all; a screen or a step of a flow gets a page of its own. Done when every state Scope named is drawn on a page and has a frame.
4. **Look.** From the directory that holds `mockup/`, run `node <skill dir>/scripts/look.mjs <slug>...` for the mockup's slugs. It screenshots every frame, and every `play` run, into `mockup/<slug>/shots/` and the board into `mockup/board.png`, and prints its findings and `count`. A `low-contrast` or `small-target` finding stays out of `count`: fix it where the mockup chose the color or the size, keep it where the design system did. Read every screenshot for what it cannot see: a separator (`·`, `|`) opening or closing a line, a button pushed onto a line of its own, a band of dead space, text over an image it cannot be read on. Fix and run again, up to three passes. Done when it prints `count: 0` and the screenshots show none of those, or after the third pass.
5. **Hand over.** The reply is a summary of a few lines, what the board shows and the choice it leaves open, then the board's absolute path to `mockup/index.html`, and the turn ends. Each variant's downside already stands on the board in its `note`, and the user picks there.

## Craft

- Variants differ on one named axis each (layout, density, wording, motion, interaction model); two that differ only in color or copy are one variant. The title names the direction, never "Option A"
- Every page works: real interactions, realistic copy, plausible sample names and numbers

## Gotchas

- The user opens the board straight from disk. Each page carries its own `<!doctype html>`, `<meta charset="utf-8">` and viewport meta, or non-ASCII letters arrive garbled; fonts load from Google Fonts with the app's fallback stack, everything else is inline
- A clip that is the design, such as a long name ending in an ellipsis, carries `data-clip` on the clipping element and Look passes it
- Look shoots 600 ms after load: a page reaches its complete look by then. The board runs every page at once, so motion plays once and settles; an indicator the app animates while it lasts, such as a loading spinner, loops

## Shape

`mockup/board.js`, one call per section:

```js
board({
  slug: "export-button",
  title: "Export button on the orders list",
  question: "Which export button goes forward?",
  frames: [
    {
      id: "A",
      file: "A.html",
      title: "Icon in the toolbar",
      note: "Easy to miss next to the filters.",
    },
    { id: "A", file: "A.html", size: "phone" },
    {
      id: "B",
      file: "B.html",
      title: "Labelled button",
      note: "Pushes the search field narrower on a phone.",
      play: [{ name: "open", steps: [{ click: "#export" }] }],
    },
  ],
});
```

A frame is one page at one `size`: `"desktop"` (1440×900, the default), `"tablet"`, `"phone"` (390×844) or `{ w, h }`; another size is another frame. `note` is the real downside of a variant, or a caption. `play` lists the interactions Look runs, each from a fresh load, screenshotted after its last step: `click`, `hover` (a selector), `fill` (`[selector, text]`), `press` (a key), `drag` (`[selector, dx, dy]`), `wait` (ms), `eval` (JS). A page with a control or motion gets one run per state it reaches.
