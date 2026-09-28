---
name: record-walkthrough
description: 'Record one video of a finished change for a person to watch, a chapter per criterion. Use on the user''s word once a browser walk of its criteria passed.'
compatibility: Requires the running app, playwright-cli and ffmpeg
---

# Record walkthrough

One output: a video a person watches instead of clicking through the change. A browser walk has already proved the criteria; this skill shows them.

## Process

1. **Flow.** From the passed walk's report, the criteria in the order a user meets them, and the locators the walk used. Done when the flow is a list of steps, each with its criterion id and its target.

2. **App and session.** Start the app and claim a session as [browser.md](../check-feature/references/browser.md) says.

3. **Replay.** Write the flow as one file and run it with `run-code --filename`: a video is a replay of the settled flow, not the walk that found it. [recording.md](recording.md) carries what that file needs: the screencast size, the pace, the chapters and overlays, and how to check the first recording before keeping it.

4. **File.** The video goes to `browser/<run-id>/walkthrough.webm`, where the walk's report lives, captioned in that run's `report.md` under Artifacts with what happens in order. Cleanup as `browser.md` says. Then print the absolute path and end.
