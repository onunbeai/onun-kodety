# Onun Kodety performance playbook

Use this reference to turn PageSpeed/Lighthouse evidence or a static project
audit into safe Onun Kodety changes.

## Evidence model

For every finding record:

- metric or audit ID;
- observed value and estimated savings when supplied;
- URL/resource/selector evidence;
- responsible project file;
- impact: critical, high, medium, low;
- confidence: confirmed, likely, speculative;
- risk: low, medium, high;
- actionability: Builder, hosting, third party, or measurement only.

Never infer that an opportunity's estimated savings is a guaranteed metric
improvement. PageSpeed lab data varies with device, network, cache, location,
and third-party state.

## Reading project files

Use `kodety_project_snapshot` in two phases:

1. inventory pages and every file path/size;
2. request relevant ordinary text with `filePaths`.

The returned `fileSources` entries include text, original size, and whether the
response was truncated. Never replace a truncated file. Request a smaller
focused batch or report that the file could not be safely rewritten.

Use `replaceTextFile` only for a complete ordinary project text file already
read at the current revision. Use semantic component and motion tools for
their owned documents.

## Metrics to project changes

### LCP

Inspect the reported LCP element and its resource chain.

High-confidence project fixes:

- add intrinsic `width` and `height` or a stable `aspect-ratio`;
- keep the likely LCP image eager and set `fetchpriority="high"`;
- add accurate `srcset` and `sizes` when variants actually exist;
- avoid a CSS background for critical semantic imagery when a responsive
  `<img>` or `<picture>` is appropriate;
- preload only the confirmed critical image or font when discovery is late;
- remove an avoidable client-side gate that hides already-authored content;
- simplify excessive above-the-fold effects, filters, or media payload.

Do not invent resized assets that do not exist. Do not lazy-load LCP.

### CLS

Check images, video, iframes, embeds, ads, font swaps, injected banners, and
animations that change layout.

Prefer:

- intrinsic media dimensions and stable aspect ratio;
- reserved container space;
- final static layout before scripts run;
- transform/opacity motion instead of top/left/width/height when possible;
- stable fallback font metrics and deliberate font-display behavior.

Do not mask CLS with fixed heights that break responsive content.

### INP and TBT

Trace the report's long tasks and script URLs to project-owned files.

Prefer:

- remove confirmed duplicate initialization and listeners;
- make initialization idempotent;
- defer non-critical work and third-party embeds;
- split synchronous loops into bounded work when project code owns them;
- use passive listeners only when the handler never cancels scrolling;
- throttle pointer/scroll work to animation frames;
- avoid forced layout read/write ping-pong;
- reduce interaction complexity before adding more libraries.

Never add another framework or runtime to solve a payload problem.

### Render-blocking CSS and fonts

Inspect actual stylesheet order, imports, font declarations, and usage.

Safe candidates:

- remove only confirmed duplicate links/imports;
- preload one critical local font with matching type and CORS;
- use `font-display: swap` or `optional` according to brand tolerance;
- consolidate provably duplicated declarations without changing cascade;
- avoid CSS `@import` for critical local styles when a normal link is viable.

Do not perform broad unused-CSS deletion from selector grep alone. Dynamic
states, CMS, components, and breakpoints may not appear in one page source.

### Images and media below the fold

For non-critical media:

- use `loading="lazy"` on images and iframes;
- use `decoding="async"` where appropriate;
- set dimensions/aspect ratio;
- use responsive sources that already exist;
- prefer `preload="metadata"` or `none` for non-critical video;
- avoid autoplay unless muted, inline, intentional, and worth the cost.

### Third parties

Inventory analytics, chat, video, maps, social widgets, ads, and tag managers.
Delay or facade only when business and consent behavior remain correct. Do not
remove analytics or consent code without explicit authorization.

### Caching, compression, and delivery

These are normally hosting-side:

- Brotli/Gzip;
- immutable cache headers and CDN policy;
- HTTP/2 or HTTP/3;
- server response time and database work;
- edge caching and image transformation services.

Explain the recommendation and evidence, but do not claim it was applied by a
source edit.

## PageSpeed/Lighthouse input

Accept pasted text, JSON excerpts, screenshots, TXT, DOC, or DOCX. Extract
only what is present. Useful keys include:

- `categories.performance.score`;
- `audits.largest-contentful-paint`;
- `audits.cumulative-layout-shift`;
- `audits.interaction-to-next-paint` when present;
- `audits.total-blocking-time`;
- `audits.speed-index`;
- `audits.render-blocking-resources`;
- `audits.unused-javascript` and `unused-css-rules`;
- `audits.modern-image-formats`, `uses-responsive-images`, and
  `offscreen-images`;
- `audits.font-display`;
- `audits.third-party-summary` and `mainthread-work-breakdown`.

If the report omits device profile, URL, or timestamp, state the missing
context. If an image is too ambiguous to read, ask for pasted audit text rather
than guessing.

## Safe application sequence

1. Read exact source and current revision.
2. Make one coherent class of changes at a time.
3. Preserve public behavior and Builder-owned identity.
4. Apply with revision control.
5. Read back the changed sources.
6. Check responsive HTML/CSS relationships and motion companions.
7. Ask for a same-profile rerun.

## Acceptance checklist

- No changed file was truncated during read.
- LCP was not made lazy.
- Media dimensions remain responsive.
- Script order and dependencies remain valid.
- CSS cascade and component scopes are preserved.
- Native Interactions and reduced motion still work.
- No internal or generated file was changed generically.
- Every claimed change has a confirmed Builder revision.
- Metric improvements are described as pending until remeasured.
