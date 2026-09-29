# Pi remote

Watch and drive every running host pi from a phone. This directory holds the pi extension entry (`index.ts`) and the browser client, and `src/remote/` holds the server, the Sessions hub and the projection. The pi host profile `pi/profiles/host.json` loads it. Containers do not.

## How it fits together

```text
 phone ──https──▶ Tailscale Serve ──▶ 127.0.0.1:8787  Sessions
                  <mac>.ts.net                        served by whichever pi holds the port
                                                      /sessions   list of every pi
                                                      /s/<id>/    forwarded unchanged
                                                          │
                                  ┌───────────────────────┼───────────────────────┐
                                  ▼                       ▼                       ▼
                             pi listener             pi listener             pi listener
                             random loopback port, registered in remote/sessions/<id>.json
```

Every started pi listens on its own loopback port and registers it under the agent directory. One Serve entry and one link reach every session. When the pi holding the Sessions port quits, another takes it within a second, and open phones reconnect by themselves. An entry whose process is gone drops off the list.

## Setup

1. `npm ci` at the repository root, then `/reload` in pi.
2. `"remote": { "autoStart": true }` in the agent's `settings.json`, as the host profile renders it, starts remote control at every terminal-UI startup. `/reload`, a session switch, print, JSON or RPC mode, or `autoStart: false` leave it to `/remote start`. `remote.port` sets the Sessions port, 8787 by default. A non-boolean `autoStart` or a port outside 1..65535 stops the extension from loading.
3. Once, point Tailscale Serve at the Sessions port. Inspect the existing Serve configuration first, because this replaces a root handler:

   ```sh
   '/Applications/Tailscale.app/Contents/MacOS/Tailscale' serve --bg --https=443 http://127.0.0.1:8787
   ```

   The extension only reads `serve status --json` and never applies the command. It recognises a root HTTPS proxy to the Sessions port on a `.ts.net` host with Funnel off. The phone has to be on the same tailnet.

## Commands

| Command | Effect |
| --- | --- |
| `/remote start [port]` | start this session's listener and join Sessions on the given port; repeating it keeps the running listener and links |
| `/remote status` | this session's listener, the Sessions port, whether this pi serves it, Serve discovery |
| `/remote link` | the control URL and QR in a terminal widget; a loopback-only link without Serve |
| `/remote link --view` | the view-only URL and QR |
| `/remote stop` | close this listener and its phone streams; the links stay valid |
| `/remote revoke` | replace both links, end every phone stream, refuse the old links with 401 |
| `/remote help` | usage and the permission warning |

While the listener is up the footer ends with a muted `⌁ remote`, or `⌁ remote N` in the accent colour while N phones watch this session.

## Links are passwords

The control link grants the transcript and the agent's tools, with this process's permissions. The view link grants the transcript, the commands run and the files touched; the phone hides the composer and `POST /command` answers 403.

Both live in `remote/credentials.json` under the agent directory (`$PI_CODING_AGENT_DIR`, else `~/.pi/agent`), mode 0600 in a 0700 directory. They survive a restart. `/remote revoke` is the only way to end them, and it ends them in every running pi within a second. The phone moves the link from the URL fragment into `localStorage`, clears the address bar and sends it as an `Authorization` header. Clearing the site's data forgets it on that one phone.

Every listener binds `127.0.0.1` only. Responses are `no-store` with a same-origin CSP, no CORS and no external assets. The client renders markdown as a tree of fixed tags: raw HTML shows as text, links other than http and https are dropped, images become their alt text. Projected text is masked with the guard's secret pattern from `src/guard/policy.ts`, which catches known key shapes and nothing else, so it is not redaction.

## On the phone

- Queue, the default, sends a message as `followUp`: it waits for the current run, or starts one when pi is idle. Steer sends it into the running turn.
- Abort calls pi's own abort. In the terminal UI it stops the run and puts queued messages back into the terminal editor, not on the phone. Finished tool calls stay done.
- A tool call is a collapsed card: icon, one-line summary, state. Expanded, it shows an edit's diff, then the result.
- The Notify button asks for permission to notify when a turn ends. There is no service worker and no push, so a closed page stays silent.
- Terminal approval dialogs stay on the terminal. The phone shows the waiting status but cannot answer them.
- A sent message shows as "submitted, awaiting transcript" until pi echoes it. A refresh forgets that local state.

## Limits

| Limit | Value |
| --- | --- |
| snapshot | 64 messages, 32 blocks each, 16 live tools, 4096 characters per text field, 512 KiB total; oldest messages drop first, long text keeps its head and tail |
| command | 16 KiB body, 8192 characters of text |
| phone streams per session | 8, at most 4 on the view link |
| connections per port | 32; everything behind Sessions shares the Sessions port's 32 |
| slow stream | cut once 1 MiB is queued; it resyncs on reconnect |

`/new`, `/resume`, `/fork` and `/reload` rebind the remote to the new session. Commands during the gap get 503, and commands addressed to an older session get 409. `/reload` keeps the running remote implementation, so a change to runtime or projection code needs a pi restart.

## Protocol

A session listener serves its static client files publicly and four authenticated routes: `GET /bootstrap` (full snapshot), `GET /summary` (for Sessions), `GET /events` (SSE, a full snapshot per update, at most 10 per second, heartbeat every 15 s) and `POST /command` (`{ generation, action, text }`, actions `prompt`, `steer`, `followUp`, `abort`). Sessions serves `GET /sessions` and forwards `/s/<id>/<path>` to that session's listener, which authenticates it. The shapes are in `src/remote/runtime.ts`, `src/remote/hub.ts` and `src/remote/projection.ts`.

## Tests

`npm run test:remote` runs every `src/remote/` test over real loopback HTTP: credentials, Sessions with two pis, the dashboard, the client and a hostile markdown fixture. `npm run test:remote-integration` loads the extension entry and drives its commands, lifecycle hooks, autostart and footer marker. Neither needs model credentials. Neither proves a real phone, QR scanning or a particular Tailscale install.
