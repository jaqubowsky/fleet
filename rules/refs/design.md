# Design

Applies to every screen, component and layout drawn or built, in a mockup or in production code. A generic screen is the failure this guards against: one whose layout, color and copy would fit any product with the logo swapped. What the project's design system already does outranks every pattern named below: in that project it is the look, not a default. The rules bind what the change draws or builds; the unchanged screen around it keeps its look, and a finding there is named as inherited rather than redesigned. An accessibility defect on an action the task requires stays a defect, whichever component drew it.

## Direction

1. The look is the project's own: its design system, tokens, components and strings. Each element is the design system's component where one fits; a new one takes the look of its nearest existing kin, unless the order asks for a new look
2. A project with no look yet and no brief: ask one question that sets the direction (a reference product, a mood). No answer -> build plain, one neutral palette, and call it a draft without direction
3. Every visual technique has a job you can say in one line: hierarchy, state or identity. Gradient, glass blur, glow, large shadow, pill radius, background grid or dots, monospace display type, wide-tracked uppercase labels, illustration: each one earns its place on a named element, never as a page-wide default
4. Palette: two or three core colors plus one accent, neutrals free. The accent marks the key moment of the screen, the one action or the one number, and appears nowhere else
5. Theme follows the product and its users. Dark by default needs a reason (a developer or creative tool); without one, light, or a toggle that works in both modes
6. A typeface carries the product's character. A default pick (Inter, Geist, Space Grotesk, JetBrains Mono) is fine when the project already uses it
7. Icons are chosen for the meaning of the item they label. A sparkle, a lightning bolt, a robot or a magic wand labels an AI feature, nothing else. No icon fits -> the label stands alone

## Composition

1. A screen starts from its job: the one decision the user makes there. That decision's data leads the screen and everything else defers to it, one focal point per screen
2. Sections exist because the content needs them, in the order the product's story needs them. A section is never drawn because the template has one: hero + three feature cards, a "How it works" in three numbered steps, a "Trusted by" logo row, three pricing tiers with the middle one marked "Most popular", a four-column footer, a bento mosaic, a fake terminal window
3. Section compositions vary with their content: a flagship feature full width, supporting ones as a list, a card only where the item is a card. Identical cards with identical icons say every item weighs the same
4. App screens follow the same rule. The sidebar + four stat cards + chart + table shell is a template; build what the screen's decision needs
5. A table's columns come from the decision made on its rows, the deciding field early. The row menu holds the actions that exist
6. A chart's title is the question it answers: "Failed jobs per hour, last 24h", never "Overview". A sentence that answers it better replaces the chart
7. Spacing follows a scale and varies: wider gaps separate sections, tighter ones bind what belongs together
8. Decoration that marks nothing goes: an eyebrow pill above the headline repeating it, a status dot beside a label with no live state, a colored left stripe on every card, an arrow on every button, emoji in headings, buttons and bullets

## Content

1. Production code shows real data or a visibly labelled placeholder: numbers, trend deltas, testimonials, customer logos, activity feed entries, team members, security and compliance claims. A delta names its comparison period. An empty section beats a fabricated one
2. Empty form fields stay empty or carry a placeholder that says what goes there ("Your name", "email@example.com")
3. In production code every control does what it shows; a nav item leads to a page or section that exists. Not built yet -> left out, or labelled "Coming soon"
4. A call to action names its action: "Export orders", "Start a trial". "Get started", "Learn more", "Explore", "Discover" name nothing
5. Copy says what the product does: "AI-powered", "seamless", "next-generation", "revolutionary", "powerful" say nothing about it

## States

1. In production code every view that shows data has an empty, a loading and an error state; a mockup draws the states its order names. Empty says why and gives the one action that fills it ("No jobs yet. Run a sync to see results here"); loading says what it loads; error says what failed and what to do next
2. First run, filtered to nothing and permission denied are three different empty states
3. A status is never color alone: text or an icon carries it too

## Worst-case data

Demo data is chosen to make a design look good. Every view that shows user data is also drawn and tested with the worst values a real user produces:

1. List each rendered value with its source and its limit from the schema, the column or the input's `maxLength`; no limit found is a finding
2. The worst values enter where the demo data does, as a fixture or a mock, never as an edit to markup or CSS: a long but real name or email, a missing optional field, an empty list, exactly one item ("1 members"), a list past one screen, a large number. A mockup gets a frame with them beside the demo frame; a component that renders them gets a test on that fixture
3. Per field, decide: wrap what identifies a thing, truncate secondary metadata with the full value one hover away, truncate in the middle what differs at its end, never truncate numbers, amounts or dates
4. The usual causes: a flex or grid child without `min-width: 0`, a fixed-size box without `flex-shrink: 0`, a string with no break opportunity without `overflow-wrap: anywhere`, a plural hardcoded instead of from the locale

## People

1. Contrast is measured, never judged by eye: 4.5:1 for text, 3:1 for large text (24px, or 18.66px bold), component edges and the focus ring. Text over an image or a gradient passes at its worst spot
2. Every control is reached by Tab in visual order, works with Enter or Space, and shows a visible focus; a dialog closes on Escape. `outline: none` comes only with a `:focus-visible` style that replaces it
3. Text zooms to 200% without clipping or a sideways scroll
4. A focused input on a phone stays above the on-screen keyboard

## Reflow

A project that names the widths it serves, such as desktop only, is designed and checked at those widths alone; otherwise this section holds.

1. Every width from 320px to a wide desktop is a designed state: no sideways scroll, nothing clipped, nothing colliding. The band between phone and desktop (600 to 1024px) gets its own state
2. Breakpoints sit where the content breaks, not at device widths
3. On a phone the scale steps down: type through `clamp()` or a smaller step, section padding about half, a grid collapsing to one column. Grid tracks use `minmax()` or `auto-fit`; a flex or grid child can shrink (`min-width: 0`)
4. A full-height section uses `dvh`, never `100vh`, which runs under a phone's browser chrome
5. Touch targets are at least 44×44px with a gap between them; padding grows the hit area of a smaller visual. Every hover interaction has a tap equivalent
6. Navigation collapses on a phone into a bottom bar for the few primary destinations or a menu labelled "Menu". A fixed bar reserves its height and the safe-area inset, so it never covers the last item

## Motion

1. Motion explains a change: an entrance, feedback, a state moving. Nothing pulses, floats or loops without a trigger
2. `transform` and `opacity` only, `ease-out` on entrances (`cubic-bezier(0.23, 1, 0.32, 1)`), under 300ms in UI, none on actions repeated many times a day, `prefers-reduced-motion` honoured
