# Validation record

## Current WordPress-only scope

The repository now targets the WordPress plugin and shared editor core. Its reproducible gate is `npm run verify`; the CI workflow runs the same command. `npm run build` produces the installable WordPress plugin ZIP.

The WordPress-only `npm run verify` gate passed on **2026-09-29**: TypeScript and PHP syntax checks, 155 shared Node tests, isolated WordPress capability/permission/publication tests, the Motion browser suite (including all 14 page transitions), and the installable plugin build.

After removing the separate add-ons, TypeScript and the 94 performance-tool self-checks also passed. The publication test now creates its own runtime fixture, so it works in a clean checkout before compiled assets exist.

The entries below describe the earlier preparation and are retained as historical context. The standalone application, browser/Figma plugins, and separate add-ons are outside the current repository scope.

## Historical preparation checks — 2026-09-29

Before the repository was reduced to its current scope, `npm run verify` completed successfully, including the WordPress plugin and the then-present standalone application builds.

The preparation recorded:

- TypeScript checks and syntax checks for the plugin's 62 PHP files.
- 73 Node tests covering open-source access, export preservation, project storage, Agent behavior, and directory security. Some belonged to the application that has since been removed.
- Isolated PHP runtime tests for offline capability access, local updates, permissions, incremental saving, and transactional publication with simulated failures and retries.
- Motion tests in Chromium covering playback, reverse, keyframes, seek, callbacks, repeat/yoyo, stagger, easing, scroll, hover, pointer, text, preview, and preservation of authored globals.
- 14 Motion page transitions in exported HTML, including history navigation, reduced motion, and fallback without View Transitions.
- Buffered preview readiness, interpolation, cancellation, stale-message handling, and cleanup.
- Native text splitting by grapheme, word, and line, with DOM/listener restoration.
- Additional editor, animation publication, initial-paint, interaction, Agent, analytics, and media regressions.
- Segmented stability checks, including 70 CSS cases and 84 viewport combinations in Chromium, plus WebKit checks.
- Lockfile consistency using `npm ci --dry-run --ignore-scripts --offline`.

A standalone HTML application smoke test also passed during that preparation. That application and its smoke test are outside the current repository scope.

## Validation limits

The broader `npm test` chain was investigated and relevant groups were run, but there was no single complete execution of that chain after all adaptations. Some inherited tests assert textual implementation details and require maintenance as the source changes.

This edition was not installed in a real WordPress/MySQL environment during the recorded preparation. PHP runtimes used isolated test environments. External hosting, AI accounts, and other services were not exercised with real credentials.

An inherited CMS test encountered harness limitations in the autolocalization redirect path (`get_theme_root` and missing settings fields). It was outside the recorded `verify` gate; that flow still requires validation in a real WordPress environment.

See the [installed WordPress testing guide](guides/wordpress-installed-e2e.md) to run integration checks with a disposable installation and temporary credentials.
