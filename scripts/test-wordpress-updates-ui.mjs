import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const updater = readFileSync(new URL('../Wordpress/kodety/includes/class-kodety-updates.php', import.meta.url), 'utf8');
assert.doesNotMatch(updater, /https?:\/\/|wp_remote_|wp_safe_remote_|add_action|add_filter/, 'Commercial update registrations, downloads and endpoints must be absent.');
execFileSync('php', [new URL('../Wordpress/tests/updates-runtime.php', import.meta.url).pathname], { stdio: 'inherit' });
console.log('WordPress editor exposes no commercial updater.');
