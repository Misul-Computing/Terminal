---
name: frontend-design
description: >
  Universal frontend design guidance that lifts any model's UI output above
  templated, AI-generated defaults. Gives both aesthetic direction (intentional
  palette, typography, layout, a signature element) AND concrete execution
  scaffolding (explicit design-token scales, modern layout patterns, an
  accessibility/quality floor, an anti-"AI-look" checklist) so a weak model gets
  the mechanics it lacks and a strong model gets the taste it needs. Use whenever
  building, styling, or redesigning any user interface — web pages, components,
  landing pages, dashboards, apps — or when frontend output looks generic,
  templated, or "AI-generated".
license: MIT
---

# Frontend Design

Act as the design lead at a small studio whose work is never mistaken for anyone
else's. The job is a distinctive, intentional interface — not a templated default.
This skill works for any model: if you already have taste, use the direction; if
you don't, follow the concrete scaffolding and you will still clear the bar.

## 1. Ground it in the subject

Before designing, name three things in one line: the concrete subject/product, its
audience, and the page's single job. State your choice. Distinctive design comes
from the subject's own world — its materials, vocabulary, artifacts — not from a
generic skin. If you know the user's prior preferences or context, use them.

## 2. Define tokens before components (the uplift step)

Most weak frontend comes from improvising values per element. Decide the system
first, then derive everything from it. Pick concrete values:

- **Color**: 4–6 named hex values — one background, one surface, one foreground,
  1–2 accents. Define them as CSS custom properties. Check text/background
  contrast ≥ 4.5:1 (≥ 3:1 for large text).
- **Type scale**: one modular ratio (e.g. 1.2 / 1.25 / 1.333) from a base of
  16px. Set steps explicitly (e.g. 16 / 20 / 25 / 31 / 39 / 49). Two faces: a
  characterful display, a readable body; a mono/utility face only if data or
  captions need it. Set weights and line-heights deliberately (tight for
  display ~1.1, comfortable for body ~1.5).
- **Spacing**: one rhythm (4px or 8px base) used for every margin, padding, and
  gap. No arbitrary one-off pixel values.
- **Radius / shadow / border**: pick one radius scale and at most two elevation
  shadows. Consistency reads as intentional; mixing reads as AI-generated.

Put these in `:root` as custom properties and reference them everywhere. The
token system is what lets a less-capable model produce coherent output.

## 3. Layout and structure

Use modern CSS: `grid` for 2-D page structure, `flex` for 1-D rows, `gap` for
spacing (never margin hacks). Use `clamp()` for fluid type and spacing. Let
whitespace do real work — generous, asymmetric negative space looks designed;
uniform cramped padding looks templated. Structure (eyebrows, dividers,
numbering, labels) must encode something true about the content, not decorate it.
Don't add `01 / 02 / 03` markers unless the content is genuinely a sequence.

## 4. Typography carries the personality

The type treatment should be memorable, not a neutral delivery vehicle. Pair
display and body faces that contrast (e.g. a distinctive serif/grotesk display
with a clean body), not the same family you'd reach for on every project. Honor
the scale from §2; vary weight and tracking, not random sizes.

## 5. Avoid the AI-generated look (read this every time)

Current AI design clusters around three tells. If the brief doesn't explicitly
ask for one, do not drift into it:

1. Warm cream background (~#F4F1EA) + high-contrast serif + terracotta accent.
2. Near-black background + a single acid-green or vermilion accent.
3. Broadsheet layout: hairline rules, zero radius, dense newspaper columns.

Other tells to avoid: centered everything, evenly-spaced equal cards, purple→blue
gradients on buttons, emoji as section icons, three identical feature boxes, a
big number with a small label as the hero by default. When an axis is left free,
spend that freedom on a choice specific to the subject — not a default.

## 6. The signature

Choose one memorable element the page is remembered by — a hero treatment, a
motion moment, a structural device — that embodies the subject. Spend boldness
there and keep everything around it quiet. Chanel's rule: before shipping, remove
one accessory. Cut decoration that doesn't serve the brief.

## 7. Motion, deliberately

Animate to serve the subject: a load sequence, a scroll reveal, hover
micro-interactions. One orchestrated moment beats scattered effects, and too much
motion is itself an AI tell. Always wrap non-essential motion in
`@media (prefers-reduced-motion: reduce)`.

## 8. Quality floor (non-negotiable, every build)

- Responsive down to ~360px; test the narrow case, not just desktop.
- Semantic HTML (`<button>`, `<nav>`, `<main>`, headings in order) — not `<div>` soup.
- Visible keyboard focus (`:focus-visible` ring); never `outline: none` without a replacement.
- Color contrast meets WCAG AA (§2).
- Respect `prefers-reduced-motion` and `prefers-color-scheme` where relevant.
- Images have `alt`; interactive controls have accessible names.

## Process: plan, critique, build, critique again

1. **Plan** the token system (§2) + a one-line layout concept + the signature
   (§6). Sketch layout with an ASCII wireframe if it helps.
2. **Critique the plan against §5** before writing code: if any part is the
   generic default you'd produce for any similar brief, revise it and say what
   you changed and why. Do this in your thinking; only show the user once you're
   confident it'll delight them.
3. **Build** from the plan, deriving every value from the tokens. Watch CSS
   specificity — type-based (`.section`) and element-based (`.cta`) selectors
   that set the same paddings/margins can silently cancel out.
4. **Critique again** as you build; screenshot if your environment supports it —
   a picture is worth 1000 tokens. Remove one accessory.

## Copy is design material

Words exist to make the interface easier to use, not to decorate. Write from the
user's side of the screen: name things by what people control ("notifications",
not "webhook config"). Active voice; an action keeps its name through the flow
("Publish" → toast "Published"). Errors say what happened and how to fix it,
never vague, never apologizing. An empty state is an invitation to act. Sentence
case, plain verbs, no filler; one element, one job.

---

*Original Misul Terminal skill (MIT). Aesthetic principles informed by
Anthropic's `frontend-design` skill (Apache-2.0); the execution scaffolding,
token system, and quality floor are added to make the guidance universal across
models. No text is copied from that skill.*
