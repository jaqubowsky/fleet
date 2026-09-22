# Pi remote

This directory is a pi host extension; its domain code lives in `src/remote/`. The pi host settings load it from this repository (`pi/profiles/host.json`); run `npm ci` at the repository root, then `/reload` in pi. OMP does not load it: its extension API has no `agent_settled` or `session_info_changed` event. This is a host extension, not a container sidecar.

## Use

- `/remote start [port]` starts a loopback listener. Default port: 8787. Repeating start preserves the running listener and credential, even with another port argument.
- `/remote status` reports the listener and read-only Tailscale Serve discovery. It also hides the credential widget.
- `/remote link` shows the private control URL and QR in an ephemeral terminal widget. It never appends a session entry. Without Serve, this is a loopback-only link.
- `/remote link --view` shows the view-only URL and QR instead. A phone holding it sees the whole session and has no composer, no send and no abort; `POST /command` answers 403 for it. It is still a password: it exposes the transcript, the commands run and the files touched.
- `/remote stop` closes phone streams and revokes both credentials. Starting again creates a new pair.
- `/remote help` shows usage and the permission warning.

For Tailscale 1.102.4 on macOS, the one-time command for the default port is:

```sh
'/Applications/Tailscale.app/Contents/MacOS/Tailscale' serve --bg --https=443 http://127.0.0.1:8787
```

The extension only runs `serve status --json`. It never applies the command. It recognizes a root HTTPS proxy to this exact listener on a `.ts.net` host, with Funnel disabled. Inspect existing Serve configuration before applying the command, since it may replace an existing root handler. Your phone must be on the same tailnet. The control QR and URL grant access to the transcript and the agent's tools; the view pair grants the transcript alone. Treat both as passwords.

The composer chooses how a message is delivered. Queue sends it as `followUp`: while Pi is working it waits for the current run to finish, and when Pi is idle it starts a new run. Steer sends it as `steer`, into the run that is going. Queue is the default. The HTTP protocol also supports `prompt` for other clients.

The header shows what the pi context exposes: the model, context use as a percentage, the session cost summed over the branch, the working directory, and whether Pi is holding queued messages. A field the host does not expose is left out rather than shown as zero. New output scrolls into view only when you are already at the bottom; otherwise a Latest button appears and takes you there.

Abort delegates to Pi's current context. In the inspected Pi 0.85.1 terminal implementation, this interrupts the run and restores pending messages to the terminal editor, not the phone. It does not undo completed tool actions or stop the remote server. SDK hosts can bind a different abort handler.

## Lifetime

The server, bearer token, socket address and phone streams belong to the terminal process. `/new`, `/resume`, `/fork`, and `/reload` detach only the old session callbacks and bind the fresh API/context on `session_start`. Late events and shutdown from an old instance cannot affect the new binding. During the gap, commands return 503; commands addressed to an older generation return 409. Process quit and explicit stop close the listener. Reloading preserves the running implementation too. Changes to runtime or projection code require restarting the Pi process; stopping and starting remote control does not replace the process-global instance.

With the page open, a turn that ends raises one notification and a short vibration: Pi going from working to idle, or to waiting on the terminal. Permission is asked by the Notify me button, never on load, and a phone that refuses it keeps everything else. There is no service worker and no push, so a closed page stays silent. The web app manifest lets the page be added to the home screen; launched from there it carries no credential, so it asks for the link again.

The phone keeps its token only in memory, removes the fragment from browser history immediately, and uses an Authorization header. Reloading the phone page requires scanning the link again. Network reconnects and tab wakeups keep the in-memory credential and request a fresh snapshot; a wakeup aborts the stream on purpose, and that abort is reported as nothing, because only a failure the phone did not cause is worth a banner. Commands are never automatically retried, because an interrupted response might already have been accepted.

## Protocol and bounds

Public static assets: `/`, `/client.js`, `/client.css`, `/markdown.js`, `/connection.js`, `/manifest.webmanifest`, `/icon.svg`, `/vendor/marked.js`, `/vendor/highlight.js`, `/vendor/highlight-dark.css` and `/vendor/highlight-light.css`. The two libraries are `marked` 18.0.5 and highlight.js 11.9.0 as `@highlightjs/cdn-assets`, which is the same release packaged as one browser-ready file; both are exact-pinned at the repository root and read from `node_modules` at start, and nothing is fetched from a CDN at runtime. Every other path is authenticated:

- `GET /bootstrap`: version 2 snapshot, generation, session id/name, status, header, transcript and live assistant and tool state. A message is an ordered list of blocks: text, or a tool call carrying its id, name, one-line summary, state, result and, for an edit, a unified diff. A tool result never appears as a row of its own; it joins its call by tool-call id inside the turn that ran it.
- `GET /events`: native HTTP SSE snapshots, with a complete snapshot on every connection. No historical replay or unbounded event journal. Heartbeats every 15 seconds; updates coalesced to at most 10 per second.
- `POST /command`: JSON `{ generation, action, text }`. Actions are `prompt`, `steer`, `followUp`, and `abort`. Abort omits text. Prompt is rejected while busy; every action is rejected with 403 for the view token. Input is plain text, not remote slash-command dispatch.

Projection excludes raw Pi objects, thinking blocks, image payloads, tool result details other than an edit's patch, usage, auth and model configuration. Tool arguments are projected, reduced to a one-line summary per tool: the command for bash, the path for read, write and edit, the pattern and path for grep and find, the query or URL for the web tools, the agent and task for a sub-agent, and the name with its argument keys for anything else. Every projected string is masked with the guard's own secret pattern, imported from `src/guard/policy.ts`, so an API key or a private key header reads as `[redacted]`. Masking catches those shapes and nothing else; displayed text can still contain a secret the pattern does not know, and projection is not content redaction. Snapshots contain at most 64 messages, 32 blocks per message, 16 live tools and 4096 characters per text field, and the whole transcript is held under 512 KiB by dropping the oldest messages first. A long result, diff or message text is cut to its head and tail with the omitted count in between, so the start and the end of a long output both survive.

On the phone a tool call is a card: collapsed it is one line with an icon, the summary and its state, spinning while it runs and marked when it fails; expanding it shows the diff coloured by added and removed lines, then the result. A running call is pinned above the composer until its message arrives, and never shows twice. Older text is omitted. Each command is limited to 16 KiB and 8192 text characters; headers to 8 KiB; connections to 32; phone streams to 8, of which at most 4 may hold the view-only link, so a shared link can never take the controlling phone's stream. Slow streams are disconnected after their output queue exceeds 1 MiB and resync on reconnect. Full snapshots trade bandwidth for bounded, lossless state resynchronization within these display limits.

The listener binds only `127.0.0.1`. API requests require one of two random 256-bit bearer tokens, the control token or the view token; the snapshot names which one the phone holds, so the client hides the composer rather than discovering the limit from a rejection. Responses are no-store, with a same-origin CSP, no CORS and no external assets. Assistant and user text is rendered as markdown: `marked` tokenizes it, a pure function turns the tokens into a tree of fixed tags, attributes and text, and the client builds that tree with `createElement` and `textContent`. Raw HTML in the source appears as text, a link is dropped unless it is http or https, and images are reduced to their alt text. The single `innerHTML` assignment in the client takes highlight.js output, which escapes its input. Tool output is not parsed as markdown. Terminal approval dialogs remain on the terminal; the phone shows a waiting status but cannot answer them.

## Verification

`node --test src/remote/markdown.test.ts` proves the markdown tree against a hostile fixture: a script tag, an `img` with `onerror` and a `javascript:` link leave no attribute that runs. `npm run test:remote` exercises real loopback HTTP with session callbacks as doubles. `npm run test:remote-integration` loads the extension entry point, invokes its commands and lifecycle hooks, and proves fresh factories retain process identity, use the current callbacks, and stop/revoke correctly. These checks require no model credentials. They do not prove physical-phone access, QR scanning, or a particular macOS Tailscale/Pi installation.
