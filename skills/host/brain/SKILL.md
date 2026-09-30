---
name: brain
description: 'Answer a question from the personal knowledge base (LLM wiki) at ~/my-knowledge-base. Use when the user asks what their second brain / wiki / notes say about a topic, or wants past research, course notes, or decisions recalled.'
---

Answer the question using the personal knowledge base at
`{{wiki}}`.

Question: the text the user appended after this skill

1. Read `{{wiki}}/wiki/index.md` and pick the
   relevant pages; read only those (plus the `wiki/sources/` pages they cite
   if needed). Never bulk-load the whole wiki into context.
2. Answer with citations: wiki page names and their `raw/` sources. If the
   wiki has nothing on the topic, say so plainly: do not substitute general
   knowledge as if it came from the wiki.
3. The knowledge base is read-only from this session. If the answer revealed
   a gap or produced a synthesis worth keeping, suggest running `{{skill.ingest}}` in
   the knowledge-base repo instead of writing to it directly.

Done when every claim in the answer carries the page it came from and that
page's `raw/` source, or the answer says plainly that the wiki holds nothing
on the topic. A page that contradicts the codebase or a primary source is
reported with both, and they win.
