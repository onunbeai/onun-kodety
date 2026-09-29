# Onun Kodety native motion engine

Use this reference when reading, proposing, or authoring Interactions v2.

## Builder tools

`kodety_motion_snapshot` returns:

- the current project revision;
- complete page Interactions v2 documents for requested HTML paths;
- each canonical companion path;
- optionally, the live Builder Library catalog.

`kodety_apply_motion` accepts an exact `expectedRevision`, a summary, and one
or more `{ pagePath, interactions }` replacements. Each `interactions` value is
the complete document for that page. Preserve entries outside the requested
scope. The Builder validates and normalizes the document, writes the canonical
companion, refreshes preview state, and returns the new revision.

For a component master, read and write interactions through
`kodety_component_snapshot` and `kodety_apply_component_changes` instead.

## Motion fingerprint

Before proposing an effect, summarize:

1. existing trigger distribution: load/appear, scroll, hover, click, pointer;
2. median entrance duration and common stagger interval;
3. dominant easing family and typical travel/scale range;
4. repeated Library effect IDs;
5. reduced-motion and breakpoint conventions;
6. whether the target is intentionally exceptional.

Match repeated choices by default. A new focal section may introduce one new
gesture while keeping timing, easing, and reduced motion familiar.

## Current Builder Library

Prefer these effects when their semantics fit. The snapshot remains canonical
if this catalog evolves.

| Group | Effects |
|---|---|
| Reveal | Fade In, Fade Up/Down/Left/Right, Scale In, Zoom Out, Rotate In, Blur Reveal, Mask Reveal, Clip Up |
| Text | Words Reveal, Characters Reveal, Lines Reveal, Blur Words, Text/Words/Characters Roll, Stagger Children |
| Pointer | Hover Lift, Hover Scale, Magnetic |
| Data | Count Up |
| Scroll | Parallax Y, Scroll Scale, Scroll Rotate, Image Sequence, Video Scrub |

Library-authored interactions carry `libraryEffectId`. Preserve it when merely
retiming or retargeting that effect; clear it for a substantially custom
composition.

## Document shape

```json
{
  "version": 2,
  "interactions": [
    {
      "id": "hero-entrance",
      "name": "Hero entrance",
      "trigger": "scroll",
      "triggerSelector": "[data-kodety-interaction-id=\"hero\"]",
      "triggerLabel": "Hero",
      "triggerTargetMode": "element",
      "actions": [],
      "enabled": true,
      "repeat": 0,
      "yoyo": false,
      "hoverInAction": "restart",
      "hoverOutAction": "reverse",
      "clickAction": "toggle",
      "mouseMoveAxis": "both",
      "mouseMoveReverse": true,
      "mouseMoveSmoothing": 0.18,
      "scrollStart": "top 82%",
      "scrollEnd": "bottom 18%",
      "scrollScrub": false,
      "scrollSmoothing": 0,
      "scrollToggleActions": "play none none reverse",
      "scrollTriggerSelector": "",
      "scrollTriggerLabel": "Animated element",
      "customEvent": "kodety-interaction",
      "reducedMotion": "end",
      "enabledBreakpoints": ["desktop", "tablet", "mobile"],
      "libraryEffectId": "fade-up",
      "behavior": null
    }
  ]
}
```

Accepted triggers: `load`, `scroll`, `hover`, `click`, `click-start`,
`appear`, `mouse-enter`, `mouse-leave`, `mouse-move`, and `custom`.

Use `load` for one deliberate page entrance, `scroll` for viewport reveals or
scrubbed sequences, `hover` for reversible pointer feedback, `click` for
stateful intent, and `mouse-move` only for a genuine pointer-driven behavior.

## Action shape

```json
{
  "id": "hero-copy-enter",
  "name": "Hero copy enter",
  "kind": "animate",
  "target": {
    "selector": ".hero__copy > *",
    "label": "Hero copy children",
    "scope": "descendants",
    "mode": "selector"
  },
  "start": 0.08,
  "duration": 0.7,
  "ease": "power3.out",
  "from": { "opacity": 0, "y": 28 },
  "to": { "opacity": 1, "y": 0 },
  "keyframes": [],
  "repeat": 0,
  "repeatDelay": 0,
  "yoyo": false,
  "stagger": 0.07,
  "staggerFrom": "start",
  "textSplit": "none",
  "className": "",
  "variableName": "--motion-value",
  "variableValue": 1,
  "eventName": "kodety-action",
  "inputName": "",
  "inputValue": true,
  "componentId": "",
  "componentVariantId": ""
}
```

Action kinds: `animate`, `set`, `class-add`, `class-remove`, `class-toggle`,
`variable`, `component-variant`, `event`, `lottie`, `rive`, and `spline`.

Target scopes: `trigger`, `document`, `children`, `descendants`, `parent`,
`closest`, `siblings`, `next`, and `previous`.

Target modes: `element`, `class`, and `selector`.

Use `component-variant` only with valid component and variant IDs from a fresh
component snapshot.

## Properties and timing

Prefer these high-performance properties:

- transform: `x`, `y`, `xPercent`, `yPercent`, `scale`, `rotation`,
  `rotationX`, `rotationY`, `transformOrigin`;
- visual: `opacity`, `filter`, `clipPath`, `boxShadow`;
- SVG: `fill`, `stroke`, `strokeWidth`, `strokeDasharray`,
  `strokeDashoffset`.

The engine also supports CSS-compatible layout, size, spacing, typography,
background, and border properties, but animate them sparingly because they may
cause layout or paint work.

Use seconds. Good default ranges:

- hover feedback: 0.18–0.35;
- small reveal: 0.45–0.7;
- focal reveal/mask: 0.7–1.1;
- stagger: 0.03–0.1;
- pointer smoothing: 0.16–0.32;
- scrub smoothing: 0.08–0.2.

Prefer `power2.out` or `power3.out` for entrances, `power2.inOut` or
`sine.inOut` for symmetric motion, `none` for scroll scrub, and restrained
`back.out(...)` for expressive scale. Reuse the site's dominant family.

Use keyframes for three or more meaningful states. Keep non-negative `time`
values ordered relative to the action start.

## Behaviors

The native behavior kinds are `count-up`, `magnetic`, `text-roll`,
`image-sequence`, and `video-scrub`. Use the exact fields already returned by
the Library snapshot. Image sequences require one `{index}` token, valid frame
bounds, and at least two scroll milestones. Video scrub requires valid time
bounds and at least two milestones.

## Composition patterns

- Editorial hero: mask or clip media; reveal heading by lines/words; bring
  supporting copy in with a restrained stagger.
- Product hero: one focal media settle or parallax; concise copy fade-up; CTA
  hover feedback consistent with other buttons.
- Card grid: one section trigger and a children stagger; do not create a
  separate observer-style interaction for every card.
- Metrics: count-up only for meaningful numeric text, accompanied by a simple
  entrance rather than competing effects.
- Stateful component: component variants for real state; timeline actions for
  supporting visual continuity.

## Acceptance checks

- Every trigger selector exists in the corresponding HTML.
- Document-scoped action selectors exist; scoped relative selectors are valid
  inside their trigger.
- Interaction, action, and keyframe IDs are unique.
- Unrelated interactions are preserved.
- Final content is visible without runtime execution.
- Text splitting is used only on simple text.
- Breakpoints and reduced motion are explicit.
- Infinite repeat is reserved for ambient decorative motion.
- No duplicate CSS/JS/GSAP implementation exists.
