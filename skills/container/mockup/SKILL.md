---
name: mockup
description: 'Mockup: show the user how a change will look before it is built, as one self-contained HTML page with variants behind a switcher. Use when the order asks to see a change before the build.'
---

# Mockup

A mockup is one change drawn on the screen it lands on, before any production code moves. Each mockup has its own directory, `mockup/<slug>/`, the slug naming what it shows, where your seat's rules keep outputs, never in the working tree. A new mockup gets a new slug; a revision of one replaces its directory. The build of that change waits until the user answers it.

1. **Scope.** From the order, name each screen region the change touches and the states it needs (empty, error, long text). A small change is drawn in place on today's screen, everything around it as it is. Done when every changed region has a name.
2. **Recon.** Today's look comes from the running app on this branch, else from the components' source. Colors, spacing, type and copy are the app's own tokens and strings, in the app's language. Done when every value the mockup uses traces to a token or a string in the repo.
3. **Build.** `mockup/<slug>/index.html`, one file, phone width first, in the shape below. One variant by default; two or three when the order asks for more or leaves a visible choice open, each named by the one axis it differs on (form, wording, loudness, layout). Done when every region and state Scope named is drawn in each variant.
4. **Look.** Screenshot every variant in a browser at phone and desktop width into `mockup/<slug>/`, viewport-sized and scrolled to each changed region, since a full-page capture draws the fixed switcher where the first viewport ended, over the content. Read each screenshot. One fix pass for what they show, one more look. Done when each variant's screenshots show its changed regions and states.
5. **Hand over.** Ask the question the mockup asks, the way your seat's rules ask one: which variant, or yes or no on the single one. Name `mockup/<slug>/index.html` and one line per variant with its real downside, then end the turn. The answer is `Decided: <slug>: <variant>`, recorded beside the task's other decisions, and the build follows it.

## Gotchas

- The user opens the file straight from disk, with no server and no publishing step. It carries its own `<!doctype html>`, `<meta charset="utf-8">` and viewport meta, or non-ASCII letters arrive garbled
- The first frame is complete: every region visible without JS and before any motion. CSS shows variant A by default and the script only switches; motion plays on a switch, never on load from `opacity: 0`
- Fonts load from Google Fonts with the app's own fallback stack; everything else is inline
- The container's browser opens `file://` only when its config sets `"allowUnrestrictedFileAccess": true`; without it the open fails on `Access to "file:" protocol is blocked`

## Shape

```html
<!doctype html>
<html lang="<app language>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><slug> mockup</title>
<style>
  :root { /* the app's tokens, copied */ }
  [data-variant] { display: none; }
  body:not([data-show]) [data-variant="A"],
  body[data-show="A"] [data-variant="A"],
  body[data-show="B"] [data-variant="B"] { display: revert; }
  /* switcher: a bar fixed to the bottom, one button per variant, the axis line under it;
     body padding-bottom matches the bar's height, so the last row stays in view */
</style>
</head>
<body>
  <!-- today's screen; each changed region and each state once per variant, marked data-variant -->
  <nav aria-label="Variants">
    <button type="button" data-pick="A" aria-pressed="true">A · <axis></button>
    <button type="button" data-pick="B" aria-pressed="false">B · <axis></button>
    <p id="axis"><what A changes>. <its downside>.</p>
  </nav>
  <script>/* show(v): body.dataset.show, aria-pressed, the axis line, location.hash = v; keys 1-3 */</script>
</body>
</html>
```
