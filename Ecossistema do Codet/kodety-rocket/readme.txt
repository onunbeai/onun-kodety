=== Kodety Rocket ===
Contributors: code
Tags: performance, cache, minify, gzip, optimization
Requires at least: 6.4
Tested up to: 7.1
Requires PHP: 8.0
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

A free, conservative and fail-open WordPress performance engine from the Code ecosystem.

== Description ==

Kodety Rocket adds anonymous page caching, optional local CSS/JavaScript minification, optional selective delivery optimizations, cache invalidation, preload and explainable diagnostics.

It is a completely standalone plugin. The main Code plugin is not required. Every feature is free: there are no licenses, subscriptions, trials, paid controls or upgrade banners.

The interface defaults to English and includes Portuguese and Spanish. Dark mode follows the Code product language, with a light theme available from the toolbar.

Safety is the product contract: dynamic, authenticated, transactional, REST, AJAX, preview, search, feed and uncertain requests are bypassed. Any failed optimization returns the original asset or HTML.

== Installation ==

1. Upload and activate `kodety-rocket.zip` from Plugins > Add New.
2. Open Kodety Rocket in the WordPress admin menu.
3. Review the detected environment and exclusions.
4. Enable optional CSS, JavaScript, defer or lazy-load features one at a time.
5. Purge and preload after changing frontend behavior.

== Frequently Asked Questions ==

= Does Kodety Rocket require Code? =

No. It shares the ecosystem and visual language, but has no runtime dependency on Code.

= Is anything paid or locked? =

No. The plugin is fully free.

= What happens if an optimization fails? =

The original response or asset is used. Fail-open behavior is mandatory throughout the engine.

= How can I disable optimization if the admin UI does not load? =

Define `KODETY_ROCKET_BYPASS` as `true` in `wp-config.php`, then purge from the WordPress Plugins action when the admin is available.

= Does it install advanced-cache.php or edit .htaccess? =

No. Version 1.0 uses a conservative PHP cache and never overwrites drop-ins or server configuration.

== Changelog ==

= 1.0.0 =

* Initial standalone release.
* Conservative anonymous page cache with conditional responses and gzip variants.
* Optional per-file CSS/JS minification, selective defer and lazy loading.
* English, Portuguese and Spanish Code-styled administration.
* Purge, preload, rollback, diagnostics and emergency bypass.
