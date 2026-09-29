# Onun Kodety admin icons

## Native admin runtime

`shell.js` and `native-workspace.js` are the readable sources for the wp-admin
navigation and native-control adapter. WordPress serves their generated
`*.bundle.js` files. The same build minifies the shell, tokens and dashboard CSS
and generates audit styles for lists, media and other native screens from explicit
feature sections in one readable source. Rebuild after editing these sources:

```sh
npm run wordpress:admin-runtime
```

The packaging command runs this build automatically. The build uses esbuild,
rejects library imports, and embeds a SHA-256 digest of the source. The admin
asset tests reject stale bundles. These scripts do not run in the internal
Onun Kodety Builder or on the login screen.

### Navigation and native controls

`navigation-loading.js` observes ordinary same-site admin links without replacing
WordPress navigation. Its CSS skeleton covers only the content area. Modified
clicks, downloads, actions, local anchors and third-party workspaces keep their
native behavior. History restoration, canceled navigation and a recovery timer
clear the loading state. Reduced-motion users receive static placeholders.

`shell-first-frame.php` renders an inert initial sidebar and topbar from the
current request's permitted menu. It uses the generated `shell-icons.svg` sprite
and restores the compact preference before painting. The interactive shell
replaces it synchronously; no account-specific navigation HTML is cached.

`native-tools.js` loads only on Tools routes. Import cards, export controls and
privacy forms retain their native fields, links, nonces and handlers. Native
list actions retain their original DOM ancestry while the ellipsis trigger sits
in a final actions column. The media library keeps a single native checkbox over
each card, with a visual checkmark that cannot be displaced by WordPress styles.

Validate source/bundle freshness and navigation recovery with:

```sh
php Wordpress/tests/admin-assets-runtime.php
node scripts/test-admin-navigation-loading.mjs
```

## Solar icon registry

`kodety-icons.bundle.js` is the browser bundle for the Onun Kodety WordPress admin. It
uses the original Solar SVG geometry from
[`@solar-icons/react`](https://www.npmjs.com/package/@solar-icons/react). React
renders the source icons only during the build; the browser receives SVG strings
and a small native DOM renderer. The build rejects any React runtime dependency
in the browser bundle.

Resource and area icons use Bold Duotone. Arrows, chevrons, overflow menus,
panel controls, add/close and other directional actions use Linear stroke
geometry for clear navigation at small sizes.

Solar Icons are by [480 Design](https://www.figma.com/community/file/1166831539721848736),
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The build removes package-specific SVG root styling for our sizing API and
preserves the original paths, fill rules and secondary opacity. This attribution
also ships in the generated bundle. The Onun Kodety mark is the product's own artwork.

Build it from the repository root:

```sh
npm run wordpress:icons
```

Enqueue `admin/components/kodety-icons.bundle.js` before the Onun Kodety shell scripts.
The bundle publishes `window.KodetyIcons` and dispatches
`kodety:icons-ready` on `document` after the first DOM scan.

## JavaScript API

```js
const slot = document.querySelector('.my-icon-slot');

KodetyIcons.mount(slot, 'media', {
  size: 18,
  className: 'my-icon',
});

const icon = KodetyIcons.create('search', { size: 16 });
KodetyIcons.has('comments'); // true
KodetyIcons.names; // supported semantic names
```

`mount(target, name, options)` renders a cloned Solar SVG into a
container. Decorative icons receive `aria-hidden`; pass `label` for a named
image icon.

## Declarative API

```html
<span
  data-kodety-icon="search"
  data-kodety-icon-size="16"
></span>
```

Call `KodetyIcons.scan(root)` after rendering a component. The bundle also
observes new `[data-kodety-icon]` elements, so dynamically inserted WordPress
views are hydrated automatically.
