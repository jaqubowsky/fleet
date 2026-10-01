---
name: unslop
description: 'Cut AI tells from any writing. Must always apply.'
---

# Unslop

Edit text to remove AI patterns and add human voice.

A Polish message with a human reader on the other side (Slack, PR comment, Linear comment, standup) gets the same patterns, in the reader's language.

## Process

1. Scan for the patterns below.
2. Rewrite. Preserve meaning, match intended tone.
3. Add soul (see next section).
4. Self-audit: "What makes this obviously AI generated?" and "Does it state a fact, name, number or date the source does not?" Fix remaining tells; cut every invented fact, even when it reads more human than the vague original.

## Adding soul

Removing patterns is half the job. Sterile, voiceless writing is just as obvious.

- **Have opinions.** React to facts instead of neutrally listing pros and cons.
- **Vary rhythm.** Short sentences. Then longer ones that take their time. Mix it up.
- **Acknowledge complexity.** "Impressive but also kind of unsettling" beats "impressive."
- **Use "I" when it fits.** First person isn't unprofessional.
- **Let some mess in.** Perfect structure looks machine-made.
- **Be specific.** Not "this is concerning" but "there's something unsettling about agents churning away at 3am."

## Patterns to detect and fix

### Content

1. **Puffery.** "pivotal moment", "testament to", "evolving landscape", "setting the stage for", "indelible mark", "deeply rooted". Cut puffery, state what happened.
2. **Name-dropping.** Listing media outlets without context. Pick one, say what was said.
3. **Superficial -ing phrases.** "highlighting...", "ensuring...", "reflecting...", "showcasing...", "fostering...". Delete or expand with real sources.
4. **Promotional language.** "nestled", "vibrant", "breathtaking", "groundbreaking", "renowned", "stunning", "must-visit". Use neutral descriptions.
5. **Vague attributions.** "Experts believe", "Industry reports suggest", "Some critics argue". Name the source or delete.
6. **Formulaic challenges.** "Despite challenges... continues to thrive." Replace with specific facts.
7. **Guesses dressed as fact.** "The founder likely started small", "she maintains a low profile". Say the source does not cover it, or cut the sentence.

### Language

8. **AI vocabulary.** Additionally, crucial, delve, enduring, enhance, fostering, garner, interplay, intricate, landscape (abstract), pivotal, showcase, tapestry (abstract), testament, underscore, vibrant. Replace with plain words.
9. **Fancy ways to say "is".** "serves as", "stands as", "boasts", "features". Just say "is" or "has".
10. **"Not just X, but Y."** State the point directly instead.
11. **Rule of three.** Forcing ideas into groups of three. Use the natural number.
12. **Synonym cycling.** Protagonist, main character, central figure, hero all in one paragraph. Pick one, repeat it.
13. **False ranges.** "from X to Y" where X and Y aren't on a meaningful scale. List topics directly.
14. **Authority tropes.** "At its core", "what really matters", "the real question is", "fundamentally". They promise a deeper truth, then restate the ordinary point. Cut them, state the point.
15. **Aphorism formulas.** "X is the language of Y", "X is not a tool but a mirror", "efficiency becomes a trap when". State the plain claim behind it.

### Style

16. **Em dash overuse.** Avoid em dashes entirely. Use periods or commas only (no parentheses, no en dashes, no hyphen-as-dash substitutes). Em dashes are an AI tell, and reaching for parentheses instead just trades one tell for another. If a thought needs separation, end the sentence or use a comma.
17. **Colon overuse.** Colons are fine before a list or example. Not as mid-sentence connectors. "If you're coming from traditional automation: instead of registering event handlers, you describe conditions" adds nothing with the colon. Rewrite to let the point stand on its own without comparison framing. "Describing when the scheduler should fire works best as plain English." Same meaning, no crutch punctuation.
18. **Boldface overuse.** Don't bold every proper noun or acronym.
19. **Inline-header lists.** The tell is a bold label and colon that restates the line: "**Performance:** Performance improved...". Convert those to prose. A bold lead-in that ends in a period, names the item, and is followed by genuinely new detail ("**Schema in TypeScript.** Tables live in one file.") is fine, not a tell.
20. **Title case headings.** Use sentence case.
21. **Decorative emojis.** Remove from headings and bullets.
22. **Curly quotes.** Replace with straight quotes.
23. **Staccato drama.** "No templates. No defaults. No safety." One short sentence lands a point; a run of fragments is a drum roll. Merge them into one sentence.
24. **Scare quotes.** The "solution" "streamlines" your "workflow". Quote only a real quote, a title, or a term under discussion.
25. **All-caps emphasis.** "WE NEED TO MOVE NOW" inside a paragraph. Write the urgency into the sentence: "If we do not answer today, they sign with a competitor."

### Communication artifacts

26. **Chatbot phrases.** "I hope this helps!", "Let me know if...", "Of course!", "Certainly!", "Found the smoking gun!" Remove.
27. **Cutoff disclaimers.** "While specific details are limited..." Find sources or remove.
28. **Sycophantic tone.** "Great question! You're absolutely right!" Respond directly.
29. **Signposting.** "Let's dive in", "Here's what you need to know", "In this section we'll explore". Do the thing instead of announcing it.
30. **Fake candour.** "Honestly?", "Here's the thing", "Real talk", "Let's be honest". Say the thing.

### Filler

31. **Filler phrases.** "In order to" becomes "To". "Due to the fact that" becomes "Because". "It is important to note that" gets deleted.
32. **Excessive hedging.** "could potentially possibly be argued that it might" becomes "may".
33. **Generic conclusions.** "The future looks bright." State specific plans or facts.

### Jargon

34. **Abstract metaphor nouns.** Substrate, wedge, vector, locus, vantage, nexus, primitive (as noun), harness (as metaphor), surface (as in "API surface"), bedrock, scaffolding (as metaphor), modality, paradigm, gold-plating, ratchet (as metaphor), evacuate (for moving code), endgame, north star, flywheel. These read as technical but usually have a plainer concrete word. "Substrate" becomes "base". "Wedge in" becomes "add". "Vector" becomes "way" or "method". "Gold-plating" becomes "more than the job needs". "Ratchet" becomes the mechanism's real name or "a limit that only tightens". "Evacuate" becomes "move out". "Endgame" becomes "the last phase". Pick the concrete word.

### Plain speech

35. **Say what it does, not how it feels.** "the database stays close at hand", "SQL you can read", "types that follow your schema" name a feeling. The fix names the mechanism or a number: "`.toSQL()` returns the exact string sent to the database", "a column rename fails the build". Ask what the sentence tells the reader to do or know, then write that. If you can't restate it as a concrete instruction, fact, or number, cut it. One more check: if the sentence could appear unchanged in another project's docs, it says nothing about this one. Cut it.
36. **Shorten or split dense sentences.** If the reader has to backtrack to parse a sentence, break it in two or drop clauses. One idea per sentence.
37. **Active voice.** Prefer it. Catch "is/are/was/were + past participle" and name the actor: "queries are validated" becomes "the compiler validates queries", "the file is parsed by the loader" becomes "the loader parses the file". Passive is fine only when the actor is unknown or genuinely doesn't matter.
38. **Things with minds.** "The data tells us", "the dashboard understands what you need", "the roadmap wants". Name who acts, or the mechanism: "the dashboard opens on the three metrics you check each morning". Plain product verbs (the report shows, the form submits) stay.
39. **Cut adverbs, or use a stronger verb.** "runs quickly" becomes "is fast" or the number. "significantly improves" becomes the measured delta. An adverb propping up a weak verb means the verb is wrong.
40. **Prefer the plain word.** "utilize" becomes "use", "leverage" becomes "use", "facilitate" becomes "help", "numerous" becomes "many", "in the event that" becomes "if". The fancier synonym is rarely clearer.
