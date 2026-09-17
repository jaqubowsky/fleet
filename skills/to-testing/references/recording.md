# Recording a flow

`cursor.js` beside this file draws the pointer a recording otherwise lacks.

```bash
agent-browser open <url> --init-script <skill-dir>/references/cursor.js
agent-browser record start <artifact-dir>/<criterion>.webm
agent-browser eval "!!document.getElementById('__agent_cursor')"
agent-browser addinitscript "$(cat <skill-dir>/references/cursor.js)"
agent-browser record stop
```

Recording opens a fresh browser context, which is why the marker is confirmed after the start. The `eval` reads `true` once it is live; `false` calls for the `addinitscript` line and a reload. A page whose CSP rejects the injection leaves `agent-browser highlight <sel>` before each action, marking the target the click lands on.

Drive the flow through `agent-browser click`, `hover` and `mouse move`, which emit the real events the marker follows; a synthetic `eval(...).click()` moves the page while the cursor stays parked off screen. A target outside the viewport takes the same parking, so scroll it into frame before aiming at it.
