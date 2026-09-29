=== Kodety File System ===
Contributors: kodety
Tags: files, assets, media, storage, file manager
Requires at least: 6.4
Requires PHP: 8.0
Stable tag: 1.0.0
License: GPLv2 or later

A standalone, secure asset and file system with the Kodety interface.

== Description ==

Kodety File System is installed as its own WordPress plugin and opens in an
isolated application shell. It does not load WordPress admin styles.

Version 1.0 includes local project, public, private and import mounts; WordPress
Media integration; an optional remote Asset API provider; previews; search;
metadata; ZIP operations; resumable chunk transport; trash; versions; activity;
and a code/text editor protected by dedicated capabilities.

Private files are never intentionally served as static public files. On a
portable installation the plugin creates a private root outside the web document
root. If the host does not permit that, private mounts remain disabled until the
administrator configures KODETY_FS_PRIVATE_ROOT.

== Installation ==

1. Upload kodety-file-system.zip in Plugins > Add New.
2. Activate Kodety File System.
3. Open Kodety Files in the WordPress admin menu.

For containers or VPS deployments, define KODETY_FS_STORAGE_ROOT with the
absolute mounted path. For conventional hosting, no EasyPanel dependency is
required.

== Security ==

All browser API requests require an authenticated WordPress user, a REST nonce
and a Kodety File System capability. Storage paths are resolved only within
registered mounts. Symbolic links, traversal paths and executable public uploads
are rejected.

Active HTML, JavaScript, SVG and XML are blocked from public storage by default.
They require an explicit opt-in plus a separate HTTPS asset host.

Editing or uploading sensitive PHP, shell, ENV and server-configuration files is
disabled by default. It requires both kodety_files_edit_code and the explicit
KODETY_FS_ENABLE_DANGEROUS_FILE_EDITING constant, and is limited to protected
local mounts.

== Changelog ==

= 1.0.0 =
* Initial standalone release.
