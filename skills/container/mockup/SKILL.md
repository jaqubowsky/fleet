---
name: mockup
description: "Use when the order asks to see how a change, a screen, a flow or a component could look, work or behave before it is built."
---

# Mockup

A mockup is a search for how a thing could look, work and behave, drawn as standalone HTML pages before anyone commits to one and before any production code moves. Every mockup of a task lands on one **board**, `mockup/index.html` where your seat's rules keep outputs: a canvas with each page live in its own **frame**. A mockup is one or more **sections**, stacked down the board in reading order: a section groups the frames that belong together (one step of a flow, one component's states) under its title, numbered when the mockup has several, and is one `board({...})` call in `mockup/board.js` with its own slug and its pages in `mockup/<slug>/`. A revision replaces its own pages and edits its own calls.

The work has two zones. The **parts** come from the project unchanged: tokens (color, spacing, type, radius), components, icons, fonts, images and the strings the app already has. A part that drifts shows the user a product that will never ship. The **directions** are the work: each variant is a different answer to how the thing could look, work and behave, built from those parts, plus any copy the app lacks.

1. **Scope.** Name the thing the order asks for, the states it needs, and the job a user does with it. Read the order the simplest way that fits it; a modal, page or flow the order does not name stays out, because the user reads past every extra and judges the rest by it. A button is a button alone in its frame, a page is the whole page. Done when the thing, its states and its user's job are named.
2. **Diverge.** Before opening the screen the thing lives on today, write at least eight one-line directions, spread over three questions: how the thing could look (layout, density, hierarchy), how it could work (what it puts first, what it lets the user decide), how it could behave, written as what the user does, what visibly changes, and what that helps them decide, a rule of interaction the app has nowhere yet. Revealing a hidden detail or highlighting a selection answers how it looks. Keep the three that differ most, or the count the order names, with at least one answering how it behaves. Two directions that share a structure and differ in one property, a carousel against a grid, a gap, a color, are one. Done when each kept direction has a title naming its idea.
3. **Recon.** Read the design system and the screen around the thing, whole files: the parts come from there, and a part from outside them only where they have none. Collect the parts the pages will use, each with its source path: the tokens; each component's markup with its classes resolved to values; icons as SVG copied from the project's icon set; fonts as the app loads them, the same family, weights and styles; images whose file name or content entry shows the thing's subject, looked at before they are picked; strings from the locale file of the language the app starts in, as its i18n setup picks it. Every page follows {{refs.design}}. Done when every part the pages will use has a source path.
4. **Build.** Copy `board/*` from this skill's directory into `mockup/`, overwriting; `mockup/board.js` is yours. Write each page as `mockup/<slug>/<page>.html` from the parts, and add its sections to `mockup/board.js` in the shape below. Each direction is a page of its own and stays native: someone who knows the app takes it for a new screen of this app. Copy the app lacks is written in its language and its voice. Each screen and step of a flow is a page of its own; a component's kinds and states share one page, side by side. Done when every state Scope named is drawn on a page, each page has one frame whatever sizes the project's own rules name, and each variant tells apart from the others at a glance on `board.png`: the user drags a frame's corners to any width, and Look shoots every page at 320 and 768px.
5. **Look.** From the directory that holds `mockup/`, run `node <skill dir>/scripts/look.mjs <slug>...` for the mockup's slugs. It screenshots every frame, every `play` run and each page narrowed to 320 and 768px into `mockup/<slug>/shots/` and the board into `mockup/board.png`, and prints its findings and `count`. A `low-contrast` or `small-target` finding stays out of `count`: fix it where the mockup chose the color or the size, keep it where the design system did. Read every screenshot for what it cannot see: a separator (`·`, `|`) opening or closing a line, a button pushed onto a line of its own, a band of dead space, text over an image it cannot be read on. Fix and run again, up to three passes. Done when it prints `count: 0` and the screenshots show none of those, or after the third pass. Look and its screenshots are the whole check of a mockup and the frames your rules ask you to open; the project's proof for a changed screen belongs to the build that follows.
6. **Hand over.** A few lines: what the board shows, the choice it leaves open, and the board's absolute path to `mockup/index.html`. The reply says the same, and the turn ends.

## Craft

- Each variant is a proposal a product designer would present: one focal point, hierarchy through scale and contrast, real imagery
- A control inside the thing does what it will do in the app. One that leads out of it, a link to an offer or "see more", shows hover and focus and leads nowhere: what it would open is another mockup
- Every word on a page is in the app's language and belongs to the design; the page says nothing about itself
- Names, numbers and listings come from the project's seed or content data where it has them

## Gotchas

- The user opens the board straight from disk. Each page carries its own `<!doctype html>`, `<meta charset="utf-8">` and viewport meta, or non-ASCII letters arrive garbled; parts load by absolute path or from Google Fonts, everything else is inline
- A clip that is the design, such as a long name ending in an ellipsis, carries `data-clip` on the clipping element and Look passes it
- Look shoots 600 ms after load, so a page reaches its complete look by then. The board runs every page at once, so motion plays once and settles; an indicator the app animates while it lasts, such as a loading spinner, loops

## Shape

`mockup/board.js`, one call per section:

```js
board({
  slug: "export-button",
  title: "Export button on the orders list",
  frames: [
    {
      id: "A",
      file: "A.html",
      title: "Export as a quiet icon in the toolbar",
    },
    {
      id: "B",
      file: "B.html",
      title: "A labelled export button leads the toolbar",
      play: [{ name: "open", steps: [{ click: "#export" }] }],
    },
  ],
});
```

A frame opens at 1440×900; `size: { w, h }` opens it at the thing's own size when that is smaller than a page, or at a size the order names. `play` lists the interactions Look runs, each from a fresh load, screenshotted after its last step: `click`, `hover` (a selector), `fill` (`[selector, text]`), `press` (a key), `drag` (`[selector, dx, dy]`), `wait` (ms), `eval` (JS). Each state Scope named that needs an interaction to reach gets one run.
