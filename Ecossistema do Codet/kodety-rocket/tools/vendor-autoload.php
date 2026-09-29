<?php

declare(strict_types=1);

/**
 * Minimal autoloader for Kodety Rocket's build-time-prefixed dependencies.
 *
 * Keeping this loader private avoids registering Composer package metadata or
 * third-party namespaces globally inside a shared WordPress process.
 */
return spl_autoload_register(
    static function (string $class): void {
        $prefixes = [
            'KodetyRocketVendor\\MatthiasMullie\\Minify\\' => __DIR__ . '/minify/src/',
            'KodetyRocketVendor\\MatthiasMullie\\PathConverter\\' => __DIR__ . '/path-converter/src/',
        ];

        foreach ($prefixes as $prefix => $directory) {
            if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
                continue;
            }

            $relative = substr($class, strlen($prefix));
            if ($relative === '' || preg_match('/^[A-Za-z0-9_\\\\]+$/D', $relative) !== 1) {
                return;
            }

            $file = $directory . str_replace('\\', '/', $relative) . '.php';
            if (is_file($file)) {
                require $file;
            }

            return;
        }
    },
    true,
    false
);
