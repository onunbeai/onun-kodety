# Local quality checks and WordPress releases

This repository builds the main Onun Kodety WordPress plugin and its shared editor core. Separately distributed add-ons are not included.

## Development commands

Use Node.js 22.12+ or a supported Node.js 24/26 release, npm, and PHP 8.0+.

- `npm run dev`: watch and rebuild the main plugin's editor assets.
- `npm run check`: check TypeScript and PHP syntax.
- `npm run verify`: run the WordPress validation and build gate.
- `npm test`: run the broader regression suite.
- `npm run build`: produce the installable plugin ZIP.

Browser tests require Chromium, installed with `npx playwright install chromium`. A local WordPress 6.4+ installation is required to exercise the installed plugin.

## Versioning and packaging

`package.json` contains two version identifiers: `version` is the npm workspace's SemVer version and must match `package-lock.json`; `kodety.wordpressVersion` is the literal WordPress distribution version and must match the plugin header, `KODETY_VERSION`, and changelog. This preserves public versions such as `1.1.01` without npm normalizing them to `1.1.1`.

The build writes the versioned archive to `Wordpress/dist/<version_with_underscores>.zip`. Validate and install that exact archive when checking a release; copying individual source files into an installation does not validate the packaged plugin.

Packaging checks inspect the compiled manifest, required assets, paths, and version consistency. Generated assets and release ZIPs stay outside version control. Never include credentials, private keys, local databases, or customer projects in a package.

## Installed validation

Isolated JavaScript and PHP tests do not replace checking the plugin in a real WordPress environment. Use a disposable installation with temporary credentials, and test authentication, editing, saving, preview, and publication.

See the [installed WordPress testing guide](wordpress-installed-e2e.md) for environment variables, test profiles, and publication safeguards. If no installation or credentials are available, record the installed checks as pending.

Before publishing a release, record the version, archive path, size, SHA-256, checks run, and any outstanding limits. The [validation record](../validation.md) distinguishes historical results from the current gate.
