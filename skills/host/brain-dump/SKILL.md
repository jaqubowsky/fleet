---
name: brain-dump
description: 'Capture a source into the second brain''s inbox (raw/inbox/) for later ingestion. Use when the user wants to save an article URL, a YouTube video, a local PDF or a takeaway from this conversation to their knowledge base.'
compatibility: Requires defuddle, yt-dlp and pdftotext, plus write access to ~/my-knowledge-base/raw/inbox/
---

Capture a source into the second brain's inbox at
`/Users/alice/my-knowledge-base/raw/inbox/`. One file per source, named
`YYYY-MM-DD-<topic-slug>.md` (today's date, kebab-case slug). Every file
starts with a short origin header: source (repo/conversation, URL, or video
link), date, one-line context.

Input: the text the user appended after this skill. Decide the capture mode by its shape:

## 1. Article URL (http/https, not YouTube)

1. Run `defuddle <url>` and save stdout: clean article extraction, no
   boilerplate (content, not your summary: the wiki synthesis happens
   later, at {{skill.ingest}}).
2. Record the URL and fetch date in the origin header.

## 2. YouTube link

Audio + Whisper is the default. YouTube auto-captions are raw ASR and carry proper-noun
errors ("charge pt" for ChatGPT, "Mid Journey" for Midjourney) that propagate into wiki pages.

1. Get the title: `yt-dlp --print "%(title)s" <url>`.
2. Fetch subtitles without downloading the video:
   `yt-dlp --skip-download --write-subs --write-auto-subs --sub-langs "pl,en"
   -o "$TMPDIR/yt-%(id)s" <url>`
3. Strip VTT timestamps/tags and collapse duplicate lines into plain
   readable text; save it with the title and URL in the origin header.
4. If yt-dlp is unavailable (e.g. inside a sandbox), say so and ask the user
   to run /brain-dump on the Mac or paste the transcript.

## 3. Local PDF file (path ending in .pdf)

1. Extract the text: `pdftotext -layout "<file>" -` and capture stdout.
2. Clean it mechanically: drop page headers/footers and hyphenation
   artifacts, join broken lines into paragraphs. Content, not your summary:
   do not paraphrase; synthesis happens at {{skill.ingest}}.
3. Record the source file path in the origin header.

## 4. No argument, or a topic phrase

Distill the noteworthy knowledge from the CURRENT conversation (scoped to
the topic if given): conclusions, decisions with rationale, verified facts,
useful commands or snippets: NOT a transcript. One note per distinct topic.

## Rules (all modes)

- `raw/inbox/` is the only write surface from here: `wiki/`, its `index.md`
  and its `log.md` are written inside the knowledge-base repo by
  `{{skill.ingest}}`, which sweeps unprocessed `raw/` files automatically.
- If the inbox is not writable (e.g. a read-only sandbox mount), print the
  full note in the reply instead and tell the user to save it from a session
  on the Mac.
- Finish by reminding the user: run `{{skill.ingest}}` in `~/my-knowledge-base` to
  fold the capture into the wiki.
