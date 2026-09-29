# Kodety Rocket

Kodety Rocket is a standalone, free WordPress performance plugin for PHP 8.0+ and WordPress 6.4+. It belongs to the Code ecosystem visually, but it does not load or call the main Code plugin.

## What it does

- Conservative full-page cache for anonymous HTML requests.
- Immutable cache keys, TTL, atomic writes, non-blocking locks and gzip variants.
- Correct `ETag`, `Last-Modified`, `Vary` and conditional `304` responses.
- Per-file local CSS and JavaScript minification through the maintained Matthias Mullie library.
- Build-time namespace isolation for bundled libraries, preventing Composer collisions with other WordPress plugins.
- Optional selective `defer` and lazy loading, disabled by default.
- Explicit URL, query, cookie, handle and asset exclusions.
- Purge hooks for posts, terms, comments, menus, themes, plugins and settings.
- Sanitized diagnostics with reason codes and a batched cache preloader.
- English (default), Portuguese and Spanish admin UI.
- Dark-first Code interface with an optional light theme.

There are no licenses, trials, paid plans, locked controls or upgrade gates. Every shipped feature is available for free.

## Safe defaults

Page cache starts enabled behind a strict eligibility gate. CSS minification, JavaScript minification, `defer` and lazy loading start disabled. Kodety Rocket never combines files, delays JavaScript, rewrites external assets, installs a drop-in or edits server configuration.

If a request or transformation is uncertain, Kodety Rocket returns the original response or asset unchanged.

## Install for development

```bash
cd "Ecossistema do Codet/kodety-rocket"
composer install --no-dev --classmap-authoritative
```

The repository already contains the release-ready isolated dependency copy.
After updating Composer dependencies, regenerate it with a verified PHP-Scoper
PHAR:

```bash
./tools/scope-vendor.sh /absolute/path/to/php-scoper.phar
```

Install the resulting `kodety-rocket` directory in `wp-content/plugins/`, or build the distributable ZIP:

```bash
./tools/package.sh
```

The archive is written to `Ecossistema do Codet/dist/kodety-rocket.zip` with `kodety-rocket/` as its installable root.

## Emergency controls

Add this to `wp-config.php` to bypass all runtime optimization without opening the admin UI:

```php
define('KODETY_ROCKET_BYPASS', true);
```

The admin interface also provides a non-JavaScript purge action and one-action settings rollback.

## Storage and privacy

Page and asset cache files live below `wp-content/cache/kodety-rocket/{blog-id}/`. Diagnostic logs use a private, site-scoped directory below the operating system temporary directory (or the path supplied by the `kodety_rocket_log_directory` filter), with deny files added whenever that location is web-accessible. Diagnostics omit cookies, query values, request bodies, user data and absolute filesystem paths. Uninstall removes generated cache, diagnostics and scheduled jobs; persistent settings are removed only when the explicit “remove settings on uninstall” control is enabled.

## Architecture

The runtime is split by responsibility:

- request and response eligibility;
- output-buffer pipeline;
- page cache and invalidation;
- local asset resolution and minification;
- atomic persistence and locking;
- diagnostics, preload and administration.

The output-buffer callback only accepts a string and returns a string. It never starts, cleans or closes buffers. Each transformer is independent and fail-open. Writers never decide whether a request is cacheable, and the admin layer never performs optimization work.

## Verification

Run the included lightweight checks before packaging:

```bash
find . -name '*.php' -not -path './vendor/*' -print0 | xargs -0 -n1 php -l
php tests/runtime.php
node --check assets/admin.js
./tools/package.sh
```

See [`readme.txt`](./readme.txt) for end-user installation and compatibility notes.
