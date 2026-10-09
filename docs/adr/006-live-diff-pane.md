# Read container diffs in a host-side Herdr pane

## Status

Accepted.

## Context

Both pi and Claude run in private container checkouts. The user wants to inspect changes while an agent works, without opening a browser or asking the agent to run a command. Herdr supports background shortcut commands and terminal splits. Herdr GPUI's review currently requires a local checkout.

## Decision

Use one Fleet command and a host-side terminal view for both agents. A Herdr prefix shortcut toggles a right-hand split in the current tab, preserving agent focus. The pane reads Git inside the selected running container and formats the complete diff with the host's delta. It displays one scrolling document with file headings and wrapped lines. The file list jumps to a heading without replacing the document. It does not mirror the checkout or write its index.

Read again two seconds after the previous read finishes. Pause and close cancel the pending read. Closed panes do not poll. Store repository, scope, file and scroll offset in the host cache, not the repository. Check container state before executing a read; a stopped or removed container retains the last displayed snapshot with its status.

Branch scope compares the working tree against the merge base of HEAD and the container's origin base branch recorded by Fleet. For older tasks without a repository manifest, use the container's origin/HEAD. Never use the host checkout or the saved creation SHA: rebasing onto newer main would include unrelated upstream changes. Read existing container refs without fetching, and show the base in the header. Uncommitted scope compares against HEAD. Both include untracked, non-ignored files. The file list accepts mouse clicks and the wheel scrolls across file boundaries; keyboard controls remain available. Scroll position is anchored to a file so refreshing changes in earlier files does not move the reader into another file.

## Consequences

No Herdr fork or agent-specific extension is needed. The host needs delta. The pane uses terminal width that would otherwise belong to the conversation. Polling gives successive observations, not an atomic snapshot across files while the agent writes. A stop between the state check and sbx exec remains a race because sbx exec can start stopped containers. Eliminating that race requires an exec-if-running operation in the container tool.
