---
name: transcript
description: 'Use when a recording has to become text - a local audio or video file (mp3, m4a, wav, mp4, mov...), a YouTube or other online video link, a lecture, podcast, meeting, interview or voice note - and when the user asks to transcribe, subtitle or write out what was said.'
---

# Transcript

Transcribe any audio or video source on-device with Whisper (mlx-whisper) and
write the text where the user wants it. No cloud, no upload.

## Inputs

The text the user appended after this skill holds a source and an optional destination.

- **Source** (required): a path to a local audio/video file, or a URL to an
  online video. Missing or nonexistent path, no URL: ask for it and stop.
- **Destination** (optional): where the transcript goes. Resolution order:
  1. an explicit path in the arguments or in the user's message,
  2. otherwise next to the source file, named after it
     (URL source: the current working directory), and say so in the report.

  A destination that is an existing directory means `<dir>/<slug>.md`.
  A destination ending in a filename is used verbatim.

## Steps

1. **URL source**: download the audio only, into `$TMPDIR`:
   `yt-dlp -x --audio-format mp3 -o "$TMPDIR/%(title)s.%(ext)s" "<url>"`.
   Local file: skip this step, never copy the file anywhere.
2. **Transcribe**, language auto-detected:
   `mlx_whisper "<file>" --model mlx-community/whisper-large-v3-turbo --output-format txt --output-dir "$TMPDIR" --condition-on-previous-text False`

   `--condition-on-previous-text False` is required: with conditioning on,
   Whisper feeds each window's output into the next, so one bad window
   (silence, music) locks the rest of the file into a repetition loop
   ("to jest to jest ..."). The first run downloads the model (~1.6 GB, cached
   afterwards): tell the user it may take a while. Recordings over ~20
   minutes: run it in the background.

   Subtitles wanted instead of prose: `--output-format srt` (or `vtt`), and
   then steps 4 and 5 do not apply.
3. **Check for a repetition loop before writing anything**:
   `sort "$TMPDIR/<name>.txt" | uniq -c | sort -rn | head -3`.
   A line repeated hundreds of times means the transcription failed. Whisper
   decodes autoregressively, so a bad window can poison everything after it.
   Redo the file with Parakeet, whose TDT decoder cannot loop that way:
   `uv tool install parakeet-mlx` then
   `parakeet-mlx --model mlx-community/parakeet-tdt-0.6b-v3 "<file>" --output-dir "$TMPDIR" --output-format txt`

   Parakeet transcribes literally, keeping the fillers Whisper drops, and
   misspells English terms inside Polish speech ("codebu" for "codebase'u").
   Say in the report which engine produced the transcript.
4. **Write the transcript** to the destination. Start with an origin header:
   source path or URL, transcription date, model, plus any one-line context
   the user gave. Below it the transcript as readable paragraphs: join
   Whisper's line fragments into sentences, fix obvious punctuation.
5. **Never paraphrase, summarize or shorten.** A transcript is verbatim.
   A summary is a separate request.
6. If the destination is not writable (read-only mount, sandbox), say so and
   name the path that failed instead of silently picking another one.

Destination inside `~/my-knowledge-base/raw/inbox/`: finish by reminding the
user to run `/skill:ingest` in that repo to fold the transcript into the wiki.

## Common mistakes

| Mistake | Fix |
|---|---|
| Guessing a destination when the user named one | Read the whole message; an explicit path always wins |
| Filing a transcript full of repeated lines | Run the uniq check first |
| Copying the source media next to the transcript | The origin header's path is the reference |
| Blocking on a 2-hour file in the foreground | Run mlx_whisper in the background, report when done |
| Trimming filler words or "cleaning up" speech | Verbatim, only line joining and punctuation |
