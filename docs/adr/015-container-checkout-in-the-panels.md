# Show a container's changes in Herdr app's Changes view

## Status

Accepted.

## Context

The person wanted the tab bar's Changes button to show what a container's agent changed while it works, read the way GitHub's "Files changed" view shows a pull request, and only to look: no commit box, no marks of what was read. Browsing the container's whole checkout file by file was not needed. Herdr app's shipped `changes` panel runs `git` in the shown pane's folder, which for a container tab is the host checkout the container was cloned from, not the container's private checkout inside the sandbox. Shipped mods are read-only and replaced on every start; a mod cannot import a file outside its own folder, even through a symlink, so a shipped panel cannot be wrapped. A clone of one is never updated by Herdr app. `sbx exec` starts a stopped container, and a container's private checkout path and base are known only to fleet.

## Decision

The `fleet` layout's work area is a stack, `work-view`, of the active tab's terminals (`main`) and the harness's own `fleet-changes` mod (`changes`), adapted from the `threads` example in herdrdev/herdr-layout-examples (Apache-2.0). Changes covers the whole work area, because the person reads a diff with no use for the terminal beside it. The tab bar is `fleet-tabs`, a clone of the shipped `tabs` mod: its Changes button switches the stack, it has no Files button, and it remembers per tab whether Changes is open, so opening it on one tab leaves every other tab on its terminal. In a tab whose terminal carries a `fleet.sandbox` label, the panel reads `fleet patch <sandbox>`, which prints the container's changes as [006](006-container-changes-probe.md) reads them, refuses a container that is not running without executing in it, and strips terminal control characters, because the container writes the content. In any other tab the panel reads `git diff HEAD` of the local checkout and lists untracked files, whose contents load only when their card is opened; outside git it says so.

The view shows a file tree with a filter on the left, hidden when the view is narrower than 640 px, each file marked added, modified or deleted by an icon and a colour, and every changed file as a card on the right: its path, a new, deleted or binary tag, added and removed line counts, and a unified diff with old and new line numbers under each hunk header. A line longer than the card wraps onto rows without numbers. Code is coloured by a small tokenizer in the mod (keywords, strings, numbers, comments, calls, capitalised names), in the colours of Herdr app's own file viewer; Markdown and text stay plain. A click on a card's header folds it; a click on a file in the tree scrolls to its card. Deleted files start folded. A diff over 400 lines shows a line to click before it is drawn, and a file shows at most 5000 diff lines. The view is read-only and refreshes every 3 seconds, only while shown. Herdr app draws no image from a mod folder reached through a symlink, so the file icons live in `host/herdr-app/icons/` and `sync.sh` copies them to `~/.config/herdr-app/fleet-icons/`.

## Consequences

The container's changes are readable without a fetch and without starting a stopped container. Each refresh starts `zsh -ic` and node on the host and one `sbx exec`. Herdr app draws the diff as one virtual list with one click handler, so a card header has one click target: there is no copy-path button, and headers do not stay pinned while a card scrolls. Wrapping counts characters at an estimated width, so a font far wider than the default can clip a line's end. The tokenizer knows no language's grammar, so its colours are approximate. Herdr app never updates the `fleet-tabs` clone. Host tabs show this view in place of the shipped panel.
