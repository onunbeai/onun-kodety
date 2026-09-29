<?php

defined('ABSPATH') || exit;

/**
 * Compatibility facade for the editor shell. Install reviewed Onun Kodety
 * release ZIPs with WordPress' normal plugin uploader. No vendor update server,
 * automatic download or commercial update registration is used by this fork.
 */
final class Kodety_Updates {
    private static ?self $instance = null;
    public static function instance(): self { return self::$instance ??= new self(); }
    private function __construct() {}
    public function client_config(): ?array { return null; }
}
