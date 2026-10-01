---
name: mockup
description: 'Mockup: show the user how a change will look before it is built, as live pages on the task''s one board: variants to pick from, a flow of screens, a component''s states. Use when the order asks to see a change, a screen, a flow or a component before the build.'
---

# Mockup

A mockup is a change drawn as live HTML pages before any production code moves. Every mockup of a task sits on one **board**, `mockup/index.html` where your seat's rules keep outputs, never in the working tree. The board shows each page in an iframe at the sizes its entry names, so a page is the real thing: it scrolls, takes clicks and typing, and knows nothing of the board around it.

The board grows for the whole task. Each mockup is one **section**: a slug naming what it shows, its pages in `mockup/<slug>/`, and one `board({...})` call in `mockup/board.js`. A new mockup appends a section; a revision replaces its own pages and edits its own call, leaving every other section as it is.

| Kind | What it shows | Hand-over question |
| --- | --- | --- |
| `variants` | alternatives of one change, each named by the one axis it differs on (form, wording, loudness, layout) | which one |
| `flow` | screens in order: a workflow, an onboarding, a sequence of states, drawn with arrows between | yes or no, or which step changes |
| `states` | one screen or component in the states it needs (empty, loading, error, long text), or one live page to click through | yes or no |

A page is as big as what it shows: a full screen at `phone` (390×844) and `desktop` (1440×900), a component at its own `{ w, h }`.

1. **Scope.** From the order, name each region or component the change touches, the states it needs, and the kind of section that shows it. A small change is drawn in place on today's screen, everything around it as it is. Done when every changed region has a name and a kind.
2. **Recon.** Today's look comes from the running app on this branch, else from the components' source. Colors, spacing, type and copy are the app's own tokens and strings, in the app's language. Done when every value the mockup uses traces to a token or a string in the repo.
3. **Build.** On the board's first use, copy `board.html` from this skill's directory to `mockup/index.html`, unchanged. Write each page as `mockup/<slug>/<page>.html`, phone width first, and add the section's `board({...})` call to `mockup/board.js` in the shape below. One variant by default; two or three when the order asks for more or leaves a visible choice open. Done when every region and state Scope named is drawn on a page and the section's call names each page.
4. **Look.** Open each page file directly, not the board, at each of its sizes, and run `check-layout.js` from this skill's directory on it: `playwright-cli eval "$(cat <skill dir>/check-layout.js)"`. It prints `count` and one finding per page overflow, clipped text, element past the viewport edge, or short label wrapped onto a second line. Screenshot each page at each size into `mockup/<slug>/shots/<page>-<size>.png` and read every one for what the checker cannot see: a separator (`·`, `|`) opening or closing a line, a button or chip pushed onto a line of its own, a one-screen layout with a band of dead space, text over an image it cannot be read on. Fix and look again, up to three passes. Done when the checker prints `count: 0` at every size and the screenshots show none of those defects, or after the third pass with what remains named for the hand-over.
5. **Hand over.** Ask the section's question, the way your seat's rules ask one. Name `mockup/index.html#<slug>`, one line per page with its real downside, and any defect Look left; then end the turn. The answer is `Decided: <slug>: <page>`, recorded beside the task's other decisions, and the build follows it.

## Gotchas

- The user opens the board straight from disk, with no server and no publishing step. Each page carries its own `<!doctype html>`, `<meta charset="utf-8">` and viewport meta, or non-ASCII letters arrive garbled
- `board.js` is loaded by a `<script>` tag because `fetch` is blocked on `file://`; a syntax error in it empties the whole board, so open the board once after every edit to it
- A page's first frame is complete: every region visible without JS and before any motion; motion plays on interaction, never on load from `opacity: 0`
- Fonts load from Google Fonts with the app's own fallback stack; everything else is inline in the page
- The container's browser opens `file://` only when its config sets `"allowUnrestrictedFileAccess": true`; without it the open fails on `Access to "file:" protocol is blocked`

## Shape

`mockup/board.js`, one call per section, appended in the order the mockups were made:

```js
board({
  slug: "export-button",
  title: "Export button on the orders list",
  kind: "variants",
  question: "Which export button goes forward?",
  sizes: ["phone", "desktop"],
  pages: [
    { id: "A", file: "A.html", label: "Icon in the toolbar", note: "Easy to miss next to the filters." },
    { id: "B", file: "B.html", label: "Labelled button", note: "Pushes the search field narrower on a phone." }
  ]
});
```

`sizes` takes `"phone"`, `"desktop"` and `{ w, h, label }`, defaults to phone and desktop, and a page may carry its own. `note` is the page's real downside for `variants`, its caption for `flow` and `states`.

A page, `mockup/<slug>/<page>.html`:

```html
<!doctype html>
<html lang="<app language>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><slug> <page></title>
<style>
  :root { /* the app's tokens, copied */ }
</style>
</head>
<body>
  <!-- today's screen with this page's change, or the component alone -->
</body>
</html>
```
