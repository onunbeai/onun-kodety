---
name: kodety-motion
description: Analyze, propose, create, repair, and apply distinctive website motion through Onun Kodety's native Interactions v2 engine. Use when the user asks to animate a selected element, section, page, or reusable component; wants creative motion direction; wants consistency with animations already present in the Builder; or needs scroll, hover, entrance, text, pointer, media, keyframe, or component-state motion that remains editable in Onun Kodety.
---

# Onun Kodety Motion

Design motion as part of the site's visual language, then author it through the
native Onun Kodety engine so it remains editable, previewable, responsive, and safe.

## Required workflow

1. Call `kodety_progress_update` for multi-step analysis or application with
   concise stages such as inspect, design, apply, and verify. Update only after
   real milestones, keep at most one step `in_progress`, and complete the last
   step only after readback. Skip it for a quick suggestion-only answer; the
   card complements the normal thinking indicator.
2. Call `kodety_editor_context` before interpreting “this section”, “here”, or
   the current selection.
3. Call `kodety_motion_snapshot` for the current page with
   `includeLibrary: true`. For a broader system, request the other relevant
   pages too. This is the source of truth for existing motion and the effects
   currently available in the Builder.
4. Call `kodety_project_snapshot` for the relevant page source. If the target
   is a reusable component, also call `kodety_component_snapshot` with
   `includeSources`, `includeInteractions`, and `includeInstances`.
5. Build a short motion fingerprint from the project: common triggers,
   durations, easing families, travel distances, stagger rhythm, text-split
   style, breakpoints, reduced-motion behavior, and Library effect IDs.
6. Inspect the target's purpose, hierarchy, reading order, layout constraints,
   media, overflow, and interaction semantics before choosing an effect.
7. Choose one motion concept. Prefer a Builder Library effect when it expresses
   the idea; compose a custom Interactions v2 timeline only when it materially
   improves the result.
8. If the user asked only for ideas, return 1–3 ranked concepts with trigger,
   target, timing, breakpoint, accessibility, and consistency rationale. Do
   not mutate the project.
9. If the user asked to create or apply motion, preserve unrelated interactions
   and use the appropriate revision-checked transaction:
   - ordinary page motion: `kodety_apply_motion`;
   - HTML identity needed by the motion: `kodety_apply_changes` first, then
     read the new revision before `kodety_apply_motion`;
   - reusable-component motion or state changes:
     `kodety_apply_component_changes` with the complete variant document.
10. Read the motion snapshot back after the mutation. Confirm selectors,
   actions, breakpoints, reduced motion, Library provenance, and the returned
   revision. Use `kodety_focus_element` when it helps the user inspect it.

Read [references/motion-engine.md](references/motion-engine.md) before creating
or changing a motion document. It contains the current native schema, Library
catalog, and composition guardrails.

## Creative direction

- Derive the motion metaphor from the content and layout instead of choosing a
  random preset: editorial layouts may use masks and paced text; product UI may
  use restrained depth and state transitions; image-led work may use crop,
  scale, and parallax.
- Give a section one dominant gesture and at most a few supporting beats.
  Motion should clarify hierarchy rather than animate every layer.
- Reuse the project's established timing and easing language. Introduce one
  deliberate contrast only when the target is a true focal point.
- Prefer transform, opacity, filter, and clip-path for fluid motion. Avoid
  animating layout dimensions unless the effect genuinely depends on them.
- Use `textSplit` only on simple text with no semantic child elements.
- Keep pointer effects subtle and reversible. Never make hover the only way to
  access content or state.
- Keep static HTML/CSS at the final visible state. Let Interactions apply the
  `from` state at runtime.

## Native-only rules

- Never add an authored GSAP, ScrollTrigger, AOS, Web Animations, or CSS
  animation for motion that must appear in the Interactions panel.
- Never generate `data-kodety-interactions-runtime` scripts.
- Preserve every unrelated interaction when replacing a complete document.
- Use stable, unique `data-kodety-interaction-id` selectors for page motion.
- Default `reducedMotion` to `end`; use `skip` for pointer-driven or duplicated
  text behaviors; use `allow` only when motion is essential and comfortable.
- Use only `desktop`, `tablet`, and `mobile` breakpoints.
- Keep changes in draft and never claim success before the Builder returns and
  the readback confirms the new revision.

## Local or portable projects

When native `kodety_*` tools are unavailable, inspect the HTML and every
relevant `.incode/animations/*.json` document directly. Preserve the same
Interactions v2 contract and write the collision-free page companion path.
Do not edit generated runtime scripts. Validate the site with the Onun Kodety site
validator when that skill is available.

## Handoff

Report the concept, target, trigger, Library effect or custom composition,
timing language, breakpoints, reduced-motion behavior, affected page or
component, and confirmed revision. Mention any idea that was intentionally
left as a suggestion rather than applied.
