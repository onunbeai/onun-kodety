<?php

/**
 * Exercise updater coordination SQL against the real WordPress SQLite driver.
 *
 * KODETY_SQLITE_PLUGIN_DIR=/path/to/sqlite-database-integration \
 *   php Wordpress/tests/updates-sqlite-lock-runtime.php legacy
 * Repeat with "ast" for the current driver. The plugin is a test dependency;
 * no WordPress installation or persistent project database is read or changed.
 */
$driver_kind = $argv[1] ?? 'legacy';
$integration = rtrim((string) getenv('KODETY_SQLITE_PLUGIN_DIR'), '/');
if (!in_array($driver_kind, ['legacy', 'ast'], true) || !is_dir($integration)) {
    fwrite(STDERR, "Set KODETY_SQLITE_PLUGIN_DIR to the official SQLite Database Integration plugin and choose legacy or ast.\n");
    exit(1);
}
if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "The pdo_sqlite extension is required.\n");
    exit(1);
}
if ($driver_kind === 'legacy') {
    $directory = $integration . '/wp-includes/sqlite/';
    foreach (['php-polyfills.php', 'class-wp-sqlite-lexer.php', 'class-wp-sqlite-query-rewriter.php', 'class-wp-sqlite-translator.php', 'class-wp-sqlite-token.php', 'class-wp-sqlite-pdo-user-defined-functions.php'] as $file) {
        require_once $directory . $file;
    }
    $driver = new WP_SQLite_Translator(new PDO('sqlite::memory:'));
} else {
    require_once $integration . '/wp-includes/database/load.php';
    $driver_class = class_exists('WP_MySQL_On_SQLite') ? 'WP_MySQL_On_SQLite' : 'WP_PDO_MySQL_On_SQLite';
    $driver = new $driver_class('mysql-on-sqlite:path=:memory:;dbname=wordpress');
    // Match WP_SQLite_DB: the schema driver reads MySQL metadata as strings.
    $driver->setAttribute(PDO::ATTR_STRINGIFY_FETCHES, true);
}

define('ABSPATH', sys_get_temp_dir() . '/');
define('HOUR_IN_SECONDS', 3600);
define('KB_IN_BYTES', 1024);
define('MB_IN_BYTES', 1024 * 1024);
function is_multisite(): bool { return false; }
function wp_generate_uuid4(): string { return bin2hex(random_bytes(16)); }
function wp_json_encode(mixed $value): string|false { return json_encode($value); }

/** Only adapts wpdb's surface; complete production SQL is translated and executed. */
final class Kodety_Updates_SQLite_Wpdb {
    public string $options = 'wp_options';
    public function __construct(private object $driver, private bool $legacy) {}
    public function prepare(string $query, mixed ...$arguments): string {
        return preg_replace_callback('/%s/', static function () use (&$arguments): string {
            return "'" . str_replace(["\\", "'"], ["\\\\", "\\'"], (string) array_shift($arguments)) . "'";
        }, $query);
    }
    public function query(string $query): int {
        if (!$this->legacy) return (int) $this->driver->exec($query);
        $result = $this->driver->query($query);
        if ($result === false) throw new RuntimeException(strip_tags($this->driver->get_error_message()));
        return (int) $result;
    }
    public function get_var(string $query): mixed {
        if (!$this->legacy) {
            $value = $this->driver->query($query)->fetchColumn();
            return $value === false ? null : $value;
        }
        if ($this->driver->query($query) === false) throw new RuntimeException(strip_tags($this->driver->get_error_message()));
        $rows = $this->driver->get_query_results();
        return isset($rows[0]) ? array_values((array) $rows[0])[0] : null;
    }
}
$wpdb = new Kodety_Updates_SQLite_Wpdb($driver, $driver_kind === 'legacy');
$wpdb->query("CREATE TABLE wp_options (
    option_id bigint(20) unsigned NOT NULL auto_increment,
    option_name varchar(191) NOT NULL default '',
    option_value longtext NOT NULL,
    autoload varchar(20) NOT NULL default 'yes',
    PRIMARY KEY (option_id), UNIQUE KEY option_name (option_name)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
require dirname(__DIR__) . '/kodety/includes/class-kodety-updates.php';
$manager = (new ReflectionClass(Kodety_Updates::class))->newInstanceWithoutConstructor();
$invoke = static function (string $method, mixed ...$arguments) use ($manager): mixed {
    return (new ReflectionMethod(Kodety_Updates::class, $method))->invoke($manager, ...$arguments);
};
$assertions = 0;
$assert = static function (bool $condition, string $message) use (&$assertions): void {
    ++$assertions;
    if (!$condition) throw new RuntimeException($message);
};
$read_lock = static fn(): ?string => $invoke('coordination_value', 'kodety_update_install_lock');

$first = $invoke('acquire_install_lock');
$assert($first !== '', 'First update must acquire a lock.');
$assert($invoke('acquire_install_lock') === '', 'Concurrent update must remain blocked.');
$before = json_decode((string) $read_lock(), true);
$assert($invoke('refresh_install_lock', $first), 'Owner must refresh the lock with real SQLite SQL.');
$after = json_decode((string) $read_lock(), true);
$assert($after['expires'] > $before['expires'], 'An immediate refresh must advance expiration.');
$invoke('release_install_lock', 'wrong-owner');
$assert($read_lock() !== null, 'A different owner must not release the lock.');
$invoke('release_install_lock', $first);
$assert($read_lock() === null, 'Completing an update must release the lock.');
$assert($invoke('acquire_install_lock') !== '', 'The next update must start immediately.');

$expired = wp_json_encode(['token' => 'old-owner', 'expires' => time() - 1]);
$wpdb->query($wpdb->prepare('UPDATE wp_options SET option_value = %s WHERE option_name = %s', $expired, 'kodety_update_install_lock'));
$replacement = $invoke('acquire_install_lock');
$assert($replacement !== '', 'An expired lock must be reclaimed.');
$invoke('release_install_lock', 'old-owner');
$assert(json_decode((string) $read_lock(), true)['token'] === $replacement, 'A former owner must not delete its replacement.');
$invoke('release_install_lock', $replacement);
$assert($read_lock() === null, 'Replacement owner must release the lock.');

$assert($invoke('coordination_add', 'case-sensitive-lock', 'Owner'), 'Case comparison fixture must insert.');
$assert(!$invoke('coordination_compare_exchange', 'case-sensitive-lock', 'owner', 'stolen'), 'Compare-and-exchange must compare ownership byte for byte.');
$assert(!$invoke('coordination_compare_delete', 'case-sensitive-lock', 'owner'), 'Compare-and-delete must compare ownership byte for byte.');
$assert(!$invoke('coordination_compare_exchange', 'case-sensitive-lock', 'Owner ', 'stolen'), 'Compare-and-exchange must preserve trailing-space differences.');
$assert($invoke('coordination_compare_exchange', 'case-sensitive-lock', 'Owner', 'Success'), 'Exact owner must replace the value.');
$assert($invoke('coordination_compare_delete', 'case-sensitive-lock', 'Success'), 'Exact owner must remove the value.');

fwrite(STDOUT, "OK: {$assertions} updater coordination assertions against SQLite {$driver_kind}.\n");
