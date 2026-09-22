---
name: record-walkthrough
description: 'Record one video of a finished change for a person to watch: the flow replayed at a readable pace, a chapter per criterion, the target highlighted before each action. Use on the user''s word once check-feature passed, before a pull request someone will review by eye.'
compatibility: Requires the running app, playwright-cli and ffmpeg
---

# Record walkthrough

One output: a video a person watches instead of clicking through the change. `check-feature` has already proved the criteria; this skill shows them.

## Process

1. **Flow.** From the passed `check-feature` report, the criteria in the order a user meets them, and the locators the walk used. Done when the flow is a list of steps, each with its criterion id and its target.

2. **App and session.** Start the app and claim a session as [browser.md](../check-feature/references/browser.md) says.

3. **Replay.** Write the flow as one file and run it with `run-code --filename`: a video is a replay of the settled flow, not the walk that found it. [recording.md](recording.md) carries the three things that file needs, the screencast size, the pace, the chapters and overlays, and how to check the first recording before keeping it.

4. **File.** The video goes to `$FLEET_ARTIFACTS/$SANDBOX_NAME/browser/<run-id>/walkthrough.webm`, captioned in that run's `report.md` under Artifacts with what happens in order. Cleanup as `browser.md` says. Then print the absolute path and end.
