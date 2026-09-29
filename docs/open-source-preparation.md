# Onun Kodety open-source preparation

## Current scope

This repository contains the **WordPress plugin and shared editor core** maintained by [Onun](https://github.com/onunbeai). Standalone applications, browser and Figma plugins, and separately distributed add-ons are outside this repository's current scope. The standalone HTML version is available through Kodety Studio at [kodety.com/en](https://kodety.com/en).

The original private repository was left intact. The public project has an independent Git history at [onunbeai/onun-kodety](https://github.com/onunbeai/onun-kodety).

## Cleanup

- Generated builds, backup archives, local artifacts, installed dependencies, and customer delivery files are excluded from version control.
- The private commercial dashboard, Agent Gateway, and Kodety cloud account/project integrations were removed.
- Commercial serial activation, trials, paid-plan gates, upsells, and updates from the commercial server were removed from product flows.
- WordPress authentication, capabilities, nonces, revision checks, and authentication for user-configured providers were preserved.
- Cursors extracted from macOS were replaced with native CSS cursors.
- The root AI instruction guides were removed. Component and integration documentation remains with the shared core.
- The public name is **Onun Kodety**. Internal API, storage, package, and route identifiers remain compatible with existing projects.

## Animations

The bundled GSAP engine and its plugins were replaced with the MIT-licensed **Motion** core. The Interactions V2 document format remains compatible; the project runtime adapts Motion for timelines, scroll, text, preview, and publication.

Page transitions use `Motion.animateView` with the View Transition API and `Motion.animate` as a fallback. Preview transitions operate across buffered documents. No paid Motion+ features are included.

Custom JavaScript that uses GSAP-specific APIs outside the interaction contract may require manual migration. The editor no longer bundles GSAP. Scripts belonging to imported websites are not indiscriminately rewritten.

## Licenses and integrations

Original project code is GPL-3.0-only. Ycode is credited for the foundation of parts of the project, particularly its architecture; its MIT license and copyright notice are preserved in [licenses/YCODE-LICENSE.md](../licenses/YCODE-LICENSE.md).

Third-party licenses remain in place; see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). The WordPress browser Agent may use WebContainers, an optional service with separate hosted-runtime terms. External AI and integration providers use the user's credentials and infrastructure.

## Development and validation

`npm run dev` watches WordPress editor assets. `npm run build` creates the installable plugin ZIP. `npm run verify` runs the WordPress validation and build gate.

See [validation.md](validation.md) for dated results and their limits. Historical checks from the earlier multi-product preparation do not establish that the current WordPress-only gate has passed. Isolated PHP runtimes do not replace testing the plugin in a real WordPress installation.
