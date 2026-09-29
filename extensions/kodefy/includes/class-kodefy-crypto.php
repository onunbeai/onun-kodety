<?php

namespace Kodefy\Shopify;

defined('ABSPATH') || exit;

final class Kodefy_Crypto {
    private const PREFIX_SODIUM = 'sodium:';
    private const PREFIX_OPENSSL = 'openssl:';

    public static function encrypt(string $plaintext): string {
        if ($plaintext === '') return '';
        $key = self::key();
        if (function_exists('sodium_crypto_secretbox')) {
            $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
            $ciphertext = sodium_crypto_secretbox($plaintext, $nonce, $key);
            return self::PREFIX_SODIUM . base64_encode($nonce . $ciphertext);
        }
        if (function_exists('openssl_encrypt')) {
            $iv = random_bytes(12);
            $tag = '';
            $ciphertext = openssl_encrypt(
                $plaintext,
                'aes-256-gcm',
                $key,
                OPENSSL_RAW_DATA,
                $iv,
                $tag
            );
            if (is_string($ciphertext)) {
                return self::PREFIX_OPENSSL . base64_encode($iv . $tag . $ciphertext);
            }
        }
        throw new \RuntimeException('O servidor precisa de Sodium ou OpenSSL para proteger os tokens da Shopify.');
    }

    public static function decrypt(string $stored): string {
        if ($stored === '') return '';
        $key = self::key();
        if (str_starts_with($stored, self::PREFIX_SODIUM) && function_exists('sodium_crypto_secretbox_open')) {
            $payload = base64_decode(substr($stored, strlen(self::PREFIX_SODIUM)), true);
            if (!is_string($payload) || strlen($payload) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) return '';
            $nonce = substr($payload, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
            $ciphertext = substr($payload, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
            $plaintext = sodium_crypto_secretbox_open($ciphertext, $nonce, $key);
            return is_string($plaintext) ? $plaintext : '';
        }
        if (str_starts_with($stored, self::PREFIX_OPENSSL) && function_exists('openssl_decrypt')) {
            $payload = base64_decode(substr($stored, strlen(self::PREFIX_OPENSSL)), true);
            if (!is_string($payload) || strlen($payload) <= 28) return '';
            $iv = substr($payload, 0, 12);
            $tag = substr($payload, 12, 16);
            $ciphertext = substr($payload, 28);
            $plaintext = openssl_decrypt(
                $ciphertext,
                'aes-256-gcm',
                $key,
                OPENSSL_RAW_DATA,
                $iv,
                $tag
            );
            return is_string($plaintext) ? $plaintext : '';
        }
        return '';
    }

    private static function key(): string {
        return hash('sha256', wp_salt('auth') . '|kodefy-shopify|v1', true);
    }
}
