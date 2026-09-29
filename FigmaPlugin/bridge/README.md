# Figma to Kodety — local URL bridge

This companion renders a website in a local Chrome or Chromium process and sends a constrained, editable scene to the Figma plugin. It listens only on `127.0.0.1`, selecting the first free port from `7331` through `7340`.

## Run

Node.js 22.12 or newer is required.

```bash
npm install
npm start
```

The bridge looks for Chrome in the standard macOS, Windows, and Linux locations. Set `KODETY_CHROME_PATH` to an absolute executable path when the browser is installed elsewhere.

Keep the terminal open while using **Import URL** in Figma. The plugin discovers the bridge automatically.
The startup output includes the selected address and a per-process pairing token:

```text
Figma to Kodety bridge ready at http://127.0.0.1:7331
Pairing token: <session-token>
```

Paste that value into **Bridge token** in the plugin. Every import sends it in
`X-Kodety-Bridge-Token`; health discovery only returns
`pairingRequired: true` and never exposes the secret. The plugin keeps the
value only in its live window, and the bridge never writes it to disk. A new
random token is generated every time the process starts. For managed local
development, `KODETY_BRIDGE_TOKEN` may provide a token containing 16 to 256
non-whitespace characters.

## Security boundary

- The server binds only to IPv4 loopback.
- Browser requests are accepted only from Figma origins (including the desktop plugin's opaque origin).
- Imports require JSON input, `X-Kodety-Client: figma-plugin`, and the current
  `X-Kodety-Bridge-Token` value. Token comparison is timing-safe.
- Health checks announce that pairing is required without returning the token.
- The API exposes only health and URL import operations; it cannot execute caller-provided code or write arbitrary files.
- Request size, URL scheme, dimensions, strings, concurrency, runtime, node count, depth, image count, and image bytes are capped.
- Every browser and media connection is routed to the IP resolved and approved by the bridge; redirects and subrequests cannot re-resolve a hostname to a different address. Mixed public/private DNS answers fail closed.
- A public page cannot pivot image, frame, redirect, or browser subrequests into loopback, private, link-local, or reserved networks. Private imports must use `localhost`, a `.localhost` name, or a literal private IP. Loopback imports remain limited to loopback addresses, literal LAN imports remain limited to their original IP, and link-local/reserved destinations are always blocked. Public assets remain available in each mode.
- Chrome's sandbox remains enabled.

The URL is opened in a fresh incognito browser context. That context and its pages are closed after every import. Do not use the importer for pages whose content you are not authorized to process.

## Capture model and limitations

Text, common fills, borders, shadows, SVG, images, flex/grid-derived layout, and CSS variables are converted into editable Figma layers. Browser-only behavior, video playback, WebGL, complex masks, protected images, and cross-origin frames may be approximated. Enabling **Reference snapshot** adds a rendered image behind the editable layer tree for visual comparison.

The bridge intentionally does not install or download a browser. It uses a browser already present on the machine.
