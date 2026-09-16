---
name: brain
description: 'Answer a question from the personal knowledge base (LLM wiki) at ~/my-knowledge-base. Use when the user asks what their second brain / wiki / notes say about a topic, or wants past research, course notes, or decisions recalled.'
argument-hint: "[question]"
---

Answer the question using the personal knowledge base at
`/Users/alice/my-knowledge-base`.

Question: $ARGUMENTS

1. Read `/Users/alice/my-knowledge-base/wiki/index.md` and pick the
   relevant pages; read only those (plus the `wiki/sources/` pages they cite
   if needed). Never bulk-load the whole wiki into context.
2. Answer with citations: wiki page names and their `raw/` sources. If the
   wiki has nothing on the topic, say so plainly: do not substitute general
   knowledge as if it came from the wiki.
3. The knowledge base is read-only from this session. If the answer revealed
   a gap or produced a synthesis worth keeping, suggest running `/ingest` in
   the knowledge-base repo instead of writing to it directly.
