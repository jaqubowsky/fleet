# Recording a flow

A video is a replay, not the walk. The walk discovers the locators and leaves the screenshots behind it; the video re-runs the settled flow once, at a pace a person can follow. The installed `playwright-cli` skill's video reference carries the overlay API and the exact flags.

Note the locators while walking a criterion, then write the flow as a file and run it with `run-code --filename`. Three things that file carries and a command-by-command recording cannot:

- `page.screencast.start({ path, size })` at the audit's viewport. Left out, the video is that viewport scaled into 800x800, so a Full HD page arrives at 800x450, which is where a blurred recording comes from.
- `pressSequentially(value, { delay })` and a `waitForTimeout` holding each result on screen, so the pace is chosen. A walk driven one command per process spends most of its wall clock between processes, and that time lands in the recording as dead air.
- `showChapter` per criterion, carrying the criterion's id so the report's caption and the video's chapter name the same thing, and `showOverlay` on the target's bounding box before each action, so the viewer sees where the click is about to land. Overlays are `pointer-events: none` and stay up while the flow keeps clicking.

Every word on screen is read while watching rather than in the report, so chapter titles and overlay labels are written in the language the audit was asked for and quote the screen's own labels back: a caption in one language over a UI in another makes the viewer translate before they can check anything. The report around the video stays English.

An overlay is only as good as the box it was measured from. Scroll the target into view and read the box there, because a control past the edge — a row action in a horizontally scrolled table, anything below the fold — measures to coordinates outside the frame and draws where nobody is looking. Drop an overlay before the action that leaves the page, since the box it holds describes a screen the viewer is no longer on. Give the highlight its own contrast rather than dimming everything around it: a mark that misses its target then costs one invisible box, where a dim costs the whole screen.

A flow that cannot be replayed — one that consumed the state it needed — is recorded through `video-start` as the walk happens, with `video-show-actions` on, and the report says why it was the walk and not a replay.

Check the first recording of a run before keeping it: `ffmpeg -i <file>` prints its frame size and duration, and `ffmpeg -i <file> -r 1 <dir>/f%02d.png` turns it into one frame per second to look at, which is where an overlay that missed its target shows up. A size other than the audit's viewport means `screencast.start` never took it; a duration far past the flow means the pace came from waiting between processes rather than from `waitForTimeout`. Reading the file back through the page under audit answers neither question and costs the browser.
