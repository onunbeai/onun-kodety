<?php

defined( 'ABSPATH' ) || exit;

/** Encrypts provider credentials before they enter the WordPress options table. */
final class Kodety_FS_Secret_Box {
	private const SODIUM_PREFIX = 'kfs1:sodium:';
	private const GCM_PREFIX    = 'kfs1:gcm:';

	public static function is_sealed( string $value ): bool {
		return str_starts_with( $value, self::SODIUM_PREFIX ) || str_starts_with( $value, self::GCM_PREFIX );
	}

	public static function seal( string $plaintext ): string {
		if ( '' === $plaintext ) {
			return '';
		}
		$key = self::key();
		if ( function_exists( 'sodium_crypto_secretbox' ) ) {
			$nonce = random_bytes( SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
			$ciphertext = sodium_crypto_secretbox( $plaintext, $nonce, $key );
			return self::SODIUM_PREFIX . base64_encode( $nonce . $ciphertext );
		}
		if ( function_exists( 'openssl_encrypt' ) ) {
			$iv = random_bytes( 12 );
			$tag = '';
			$ciphertext = openssl_encrypt( $plaintext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, 'kodety-file-system' );
			if ( false !== $ciphertext ) {
				return self::GCM_PREFIX . base64_encode( $iv . $tag . $ciphertext );
			}
		}
		throw new RuntimeException( 'No supported authenticated encryption implementation is available.' );
	}

	public static function open( string $sealed ): string {
		if ( '' === $sealed ) {
			return '';
		}
		// Existing plaintext settings are read for migration and are sealed on the
		// next settings write. They are never returned to a browser response.
		if ( ! self::is_sealed( $sealed ) ) {
			return $sealed;
		}
		$key = self::key();
		if ( str_starts_with( $sealed, self::SODIUM_PREFIX ) && function_exists( 'sodium_crypto_secretbox_open' ) ) {
			$payload = base64_decode( substr( $sealed, strlen( self::SODIUM_PREFIX ) ), true );
			if ( false === $payload || strlen( $payload ) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES ) {
				return '';
			}
			$nonce = substr( $payload, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
			$plaintext = sodium_crypto_secretbox_open( substr( $payload, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES ), $nonce, $key );
			return false === $plaintext ? '' : $plaintext;
		}
		if ( str_starts_with( $sealed, self::GCM_PREFIX ) && function_exists( 'openssl_decrypt' ) ) {
			$payload = base64_decode( substr( $sealed, strlen( self::GCM_PREFIX ) ), true );
			if ( false === $payload || strlen( $payload ) <= 28 ) {
				return '';
			}
			$iv = substr( $payload, 0, 12 );
			$tag = substr( $payload, 12, 16 );
			$plaintext = openssl_decrypt( substr( $payload, 28 ), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, 'kodety-file-system' );
			return false === $plaintext ? '' : $plaintext;
		}
		return '';
	}

	private static function key(): string {
		$material = wp_salt( 'secure_auth' ) . "\n" . wp_salt( 'auth' ) . "\nKodety File System provider credentials";
		return hash( 'sha256', $material, true );
	}
}
