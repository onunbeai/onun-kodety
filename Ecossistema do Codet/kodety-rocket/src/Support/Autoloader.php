<?php

declare(strict_types=1);

namespace KodetyRocket\Support;

/** Minimal PSR-4-style loader so the plugin has no Composer runtime dependency. */
final class Autoloader
{
    private const PREFIX = 'KodetyRocket\\';
    private static bool $registered = false;

    public static function register(): void
    {
        if (self::$registered) {
            return;
        }

        spl_autoload_register([self::class, 'load'], true, true);
        self::$registered = true;
    }

    public static function load(string $class): void
    {
        if (strncmp($class, self::PREFIX, strlen(self::PREFIX)) !== 0) {
            return;
        }

        $relative = substr($class, strlen(self::PREFIX));
        if ($relative === '' || preg_match('/^[A-Za-z0-9_\\\\]+$/', $relative) !== 1) {
            return;
        }

        $file = dirname(__DIR__) . '/' . str_replace('\\', '/', $relative) . '.php';
        if (is_file($file)) {
            require_once $file;
        }
    }
}
