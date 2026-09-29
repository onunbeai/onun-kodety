<?php

declare(strict_types=1);

namespace KodetyRocket\Lifecycle;

final class Capabilities
{
    public const MANAGE = 'manage_kodety_rocket';

    public static function grant(): void
    {
        if (!function_exists('get_role')) {
            return;
        }

        $administrator = get_role('administrator');
        if ($administrator && method_exists($administrator, 'add_cap')) {
            $administrator->add_cap(self::MANAGE, true);
        }
    }

    public static function revoke(): void
    {
        if (!function_exists('get_role')) {
            return;
        }

        $administrator = get_role('administrator');
        if ($administrator && method_exists($administrator, 'remove_cap')) {
            $administrator->remove_cap(self::MANAGE);
        }
    }
}
