# Contributing to Onun Kodety

Onun Kodety is a visual website builder for WordPress. This repository contains the WordPress plugin and the shared editor core. Contributions to original project code are licensed under GPL-3.0-only; preserve third-party licenses and attribution, including the MIT notice for Ycode-derived code.

## Development environment

Use Node.js 22.12+ or a supported Node.js 24/26 release, npm, PHP 8.0+, and a local WordPress 6.4+ installation. Run `npm ci` at the repository root.

- `npm run dev`: watch and rebuild WordPress editor assets.
- `npm run check`: check TypeScript and PHP syntax.
- `npm run verify`: run the WordPress validation and build gate.
- `npm test`: run the broader regression suite.
- `npm run build`: build the installable WordPress plugin ZIP.

Use `Wordpress/kodety/` as the plugin directory in your local installation and open the editor through WordPress. See the [README](README.md) for setup and the [installed testing guide](docs/guides/wordpress-installed-e2e.md) for integration tests.

## Changes and pull requests

For substantial changes, open an issue describing the problem and a reproducible example. Pull requests should explain the resulting behavior and the checks actually run. Preserve compatibility with existing projects. Include focused regression coverage when changing behavior, and report any validation that still requires a real WordPress environment or external credentials.

Do not commit generated bundles, dependency directories, customer projects, credentials, or ZIP packages. Keep changes within the WordPress plugin and shared core scope.

The public name is **Onun Kodety**. Internal routes and identifiers such as `kodety`, `KODETY_*`, and `@coday/*` remain for compatibility. Do not reintroduce commercial activation or required private services. Preserve WordPress authentication, capabilities, nonces, and authentication for user-configured integrations.
