<?php

defined( 'ABSPATH' ) || exit;

final class Kodety_FS_Remote_Provider implements Kodety_FS_Storage_Provider {
	private array $settings;

	public function __construct( array $settings ) {
		$this->settings = $settings;
	}

	public function get_id(): string {
		return 'remote';
	}

	public function get_label(): string {
		return __( 'Remote Asset API', 'kodety-file-system' );
	}

	public function get_capabilities(): array {
		return array( 'list' => true, 'read' => true, 'write' => true, 'upload' => true, 'delete' => true, 'move' => true, 'copy' => true, 'versions' => true, 'visibility' => true, 'archives' => true );
	}

	public function configured(): bool {
		$token = $this->credential( 'remote_token', 'KODETY_FS_REMOTE_TOKEN' );
		$signing_secret = $this->credential( 'remote_signing_secret', 'KODETY_FS_REMOTE_SIGNING_SECRET' );
		return ! empty( $this->settings['remote_url'] ) && strlen( $token ) >= 24 && strlen( $signing_secret ) >= 32 && ! hash_equals( $token, $signing_secret );
	}

	public function list( array $args ) {
		return $this->request( 'GET', '/files', $args );
	}

	public function stat( array $args ) {
		return $this->request( 'GET', '/files/stat', $args );
	}

	public function read( array $args ) {
		$response = $this->request( 'GET', '/content', $args );
		if ( is_wp_error( $response ) ) {
			return $response;
		}
		return isset( $response['content'] ) && is_string( $response['content'] ) ? $response['content'] : new WP_Error( 'kodety_fs_remote_content', __( 'The remote API returned no file content.', 'kodety-file-system' ), array( 'status' => 502 ) );
	}

	public function write( array $args ) {
		return $this->request( 'PUT', '/content', $args );
	}

	public function upload( array $file, array $args ) {
		if ( ! isset( $file['tmp_name'] ) || ! is_readable( $file['tmp_name'] ) ) {
			return new WP_Error( 'kodety_fs_remote_upload', __( 'The upload source is unavailable.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		$size = @filesize( $file['tmp_name'] );
		$proxy_limit = (int) apply_filters( 'kodety_fs_remote_proxy_upload_bytes', 25 * MB_IN_BYTES );
		if ( false === $size || $size > $proxy_limit ) {
			return new WP_Error( 'kodety_fs_remote_upload_too_large', __( 'This file exceeds the safe WordPress proxy limit. Configure the remote provider direct/chunk upload protocol for large files.', 'kodety-file-system' ), array( 'status' => 413, 'maxBytes' => $proxy_limit ) );
		}
		$content = file_get_contents( $file['tmp_name'] ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		if ( false === $content ) {
			return new WP_Error( 'kodety_fs_remote_upload', __( 'The upload source could not be read.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		$args['name']    = (string) ( $file['name'] ?? 'upload.bin' );
		$args['mimeType']= (string) ( $file['type'] ?? 'application/octet-stream' );
		$args['contentBase64'] = base64_encode( $content );
		return $this->request( 'POST', '/upload', $args );
	}

	public function delete( array $args ) {
		return $this->request( 'POST', '/operations', array_merge( $args, array( 'action' => 'trash', 'permanent' => false ) ) );
	}

	public function get_url( array $args ) {
		return $this->request( 'GET', '/files/url', $args );
	}

	public function operation( array $args ) {
		return $this->request( 'POST', '/operations', $args );
	}

	public function test() {
		$response = $this->request( 'GET', '/health', array() );
		if ( is_wp_error( $response ) && 404 === (int) ( $response->get_error_data()['status'] ?? 0 ) ) {
			$response = $this->request( 'GET', '/files', array( 'limit' => 1 ) );
		}
		return $response;
	}

	/** @return array<string,mixed>|WP_Error */
	public function request( string $method, string $path, array $data ) {
		if ( ! $this->configured() ) {
			return new WP_Error( 'kodety_fs_remote_unconfigured', __( 'The remote Asset API is not configured.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		// `remote` is only the WordPress UI mount. The upstream API must receive
		// its own mount locator, and the HMAC below must cover that final payload.
		$data = $this->provider_request_data( $data );
		if ( is_wp_error( $data ) ) {
			return $data;
		}
		$base = untrailingslashit( esc_url_raw( (string) $this->settings['remote_url'] ) );
		$validation = self::validate_base_url( $base );
		if ( is_wp_error( $validation ) ) {
			return $validation;
		}
		$parts = wp_parse_url( $base );
		$host  = is_array( $parts ) ? strtolower( (string) ( $parts['host'] ?? '' ) ) : '';
		$method  = strtoupper( $method );
		$url     = $base . '/' . ltrim( $path, '/' );
		$nonce   = wp_generate_uuid4();
		$headers = array( 'Accept' => 'application/json', 'X-Kodety-Request-Id' => $nonce );
		$token   = $this->credential( 'remote_token', 'KODETY_FS_REMOTE_TOKEN' );
		$signing_secret = $this->credential( 'remote_signing_secret', 'KODETY_FS_REMOTE_SIGNING_SECRET' );
		if ( strlen( $token ) < 24 || strlen( $signing_secret ) < 32 || hash_equals( $token, $signing_secret ) ) {
			return new WP_Error( 'kodety_fs_remote_credentials', __( 'The remote provider requires separate access and signing credentials.', 'kodety-file-system' ), array( 'status' => 503 ) );
		}
		$options = array( 'method' => $method, 'timeout' => 30, 'redirection' => 0, 'headers' => $headers, 'sslverify' => true, 'limit_response_size' => 16 * MB_IN_BYTES );
		$body = '';
		if ( 'GET' === $method ) {
			$url = add_query_arg( $data, $url );
		} else {
			$options['headers']['Content-Type'] = 'application/json';
			$body = (string) wp_json_encode( $data );
			$options['body'] = $body;
			$options['headers']['Idempotency-Key'] = wp_generate_uuid4();
		}
		$timestamp = (string) time();
		$request_target = (string) wp_parse_url( $url, PHP_URL_PATH );
		$query = (string) wp_parse_url( $url, PHP_URL_QUERY );
		if ( '' !== $query ) {
			$request_target .= '?' . $query;
		}
		$context = $this->delegation_context( (int) $timestamp );
		$context_json = (string) wp_json_encode( $context );
		$context_header = rtrim( strtr( base64_encode( $context_json ), '+/', '-_' ), '=' );
		$canonical = $method . "\n" . $request_target . "\n" . $timestamp . "\n" . $nonce . "\n" . hash( 'sha256', $body ) . "\n" . hash( 'sha256', $context_json );
		$options['headers']['Authorization'] = 'Bearer ' . $token;
		$options['headers']['X-Kodety-Timestamp'] = $timestamp;
		$options['headers']['X-Kodety-Nonce'] = $nonce;
		$options['headers']['X-Kodety-User-Context'] = $context_header;
		$options['headers']['X-Kodety-Signature-Version'] = '1';
		$options['headers']['X-Kodety-Signature'] = hash_hmac( 'sha256', $canonical, $signing_secret );
		$internal_hosts = self::internal_host_allowlist();
		$response = in_array( $host, $internal_hosts, true ) ? wp_remote_request( $url, $options ) : wp_safe_remote_request( $url, $options );
		if ( is_wp_error( $response ) ) {
			return new WP_Error( 'kodety_fs_remote_request', $response->get_error_message(), array( 'status' => 502 ) );
		}
		$status = wp_remote_retrieve_response_code( $response );
		$body   = wp_remote_retrieve_body( $response );
		$json   = json_decode( $body, true );
		if ( $status < 200 || $status >= 300 ) {
			$message = is_array( $json ) && isset( $json['message'] ) ? sanitize_text_field( (string) $json['message'] ) : __( 'The remote Asset API rejected the request.', 'kodety-file-system' );
			return new WP_Error( 'kodety_fs_remote_error', $message, array( 'status' => $status ?: 502 ) );
		}
		return is_array( $json ) ? $json : array( 'success' => true, 'body' => $body );
	}

	/** @return array<string,mixed>|WP_Error */
	private function provider_request_data( array $data ) {
		$storage_mount = sanitize_key( (string) ( $data['storageMount'] ?? $data['storage_mount'] ?? '' ) );
		if ( '' !== $storage_mount ) {
			$data['mount'] = $storage_mount;
		} elseif ( 'remote' === sanitize_key( (string) ( $data['mount'] ?? '' ) ) ) {
			// `remote` is the adapter name, not an upstream mount. An omitted mount
			// selects the upstream's configured root/default listing.
			unset( $data['mount'] );
		}
		$destination_mount = sanitize_key( (string) ( $data['toStorageMount'] ?? $data['to_storage_mount'] ?? $data['destinationStorageMount'] ?? $data['destination_storage_mount'] ?? '' ) );
		if ( '' !== $destination_mount ) {
			$data['toMount'] = $destination_mount;
		} elseif ( '' !== $storage_mount && 'remote' === sanitize_key( (string) ( $data['toMount'] ?? '' ) ) ) {
			// Same-mount rename/duplicate/delete operations inherit the source's
			// provider-owned mount rather than leaking the virtual adapter name.
			$data['toMount'] = $storage_mount;
		}
		unset( $data['storageMount'], $data['storage_mount'], $data['toStorageMount'], $data['to_storage_mount'], $data['destinationStorageMount'], $data['destination_storage_mount'] );

		if ( is_array( $data['items'] ?? null ) ) {
			$items = array();
			foreach ( $data['items'] as $item ) {
				$normalized = is_array( $item ) ? $this->provider_request_data( $item ) : $item;
				if ( is_wp_error( $normalized ) ) { return $normalized; }
				$items[] = $normalized;
			}
			$data['items'] = $items;
		}

		$guard = new Kodety_FS_Path_Guard();
		if ( array_key_exists( 'name', $data ) ) {
			$name = $guard->sanitize_name( $data['name'] );
			if ( is_wp_error( $name ) ) { return $name; }
			$data['name'] = $name;
		}
		foreach ( array( 'path', 'toPath', 'destinationPath' ) as $path_key ) {
			if ( ! array_key_exists( $path_key, $data ) ) { continue; }
			$path = $guard->normalize_relative( $data[ $path_key ], true );
			if ( is_wp_error( $path ) ) { return $path; }
			$data[ $path_key ] = $path;
		}
		return $data;
	}

	/** @return array<int,string> */
	public static function internal_host_allowlist(): array {
		$hosts = array();
		if ( defined( 'KODETY_FS_REMOTE_INTERNAL_HOSTS' ) ) {
			$value = KODETY_FS_REMOTE_INTERNAL_HOSTS;
			$hosts = is_array( $value ) ? $value : explode( ',', (string) $value );
		}
		$hosts = (array) apply_filters( 'kodety_fs_remote_internal_hosts', $hosts );
		return array_values( array_unique( array_filter( array_map( static function ( $host ) {
			$host = strtolower( trim( (string) $host ) );
			return preg_match( '/^(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|\[[0-9a-f:]+\])$/', $host ) ? $host : '';
		}, $hosts ) ) ) );
	}

	/** @return true|WP_Error */
	public static function validate_base_url( string $base ) {
		$parts = wp_parse_url( $base );
		if ( ! is_array( $parts ) ) {
			return new WP_Error( 'kodety_fs_remote_url', __( 'The remote API URL is invalid.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		$scheme = strtolower( (string) ( $parts['scheme'] ?? '' ) );
		$host = strtolower( (string) ( $parts['host'] ?? '' ) );
		$internal = in_array( $host, self::internal_host_allowlist(), true );
		$allow_insecure = $internal && ( defined( 'KODETY_FS_ALLOW_INSECURE_REMOTE' ) && true === KODETY_FS_ALLOW_INSECURE_REMOTE );
		$allow_insecure = $allow_insecure || (bool) apply_filters( 'kodety_fs_allow_insecure_remote', false, $base );
		$valid_scheme = 'https' === $scheme || ( 'http' === $scheme && $allow_insecure );
		$port = isset( $parts['port'] ) ? (int) $parts['port'] : 0;
		if ( '' === $host || ! $valid_scheme || isset( $parts['user'] ) || isset( $parts['pass'] ) || isset( $parts['query'] ) || isset( $parts['fragment'] ) || $port < 0 || $port > 65535 ) {
			return new WP_Error( 'kodety_fs_remote_url', __( 'The remote API URL must use an approved HTTP(S) origin without credentials, query, or fragment.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		if ( ! $internal && ! wp_http_validate_url( $base ) ) {
			return new WP_Error( 'kodety_fs_remote_url', __( 'The remote API URL is not a safe public HTTPS URL.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		return true;
	}

	private function credential( string $setting, string $constant ): string {
		$value = defined( $constant ) ? constant( $constant ) : ( $this->settings[ $setting ] ?? '' );
		return trim( (string) apply_filters( 'kodety_fs_remote_credential', $value, $setting ) );
	}

	/** @return array<string,mixed> */
	private function delegation_context( int $issued_at ): array {
		$capability_map = array(
			'files:read' => 'kodety_files_read', 'files:upload' => 'kodety_files_upload',
			'files:write' => 'kodety_files_edit', 'files:delete' => 'kodety_files_delete',
			'files:private' => 'kodety_files_manage_private', 'files:share' => 'kodety_files_share',
			'files:purge' => 'kodety_files_purge', 'files:storage' => 'kodety_files_manage_storage',
		);
		$scopes = array();
		foreach ( $capability_map as $scope => $capability ) {
			if ( current_user_can( $capability ) ) { $scopes[] = $scope; }
		}
		$user = wp_get_current_user();
		return array(
			'userId' => get_current_user_id(),
			'roles' => array_values( array_map( 'sanitize_key', is_array( $user->roles ?? null ) ? $user->roles : array() ) ),
			'scopes' => $scopes,
			'site' => hash( 'sha256', home_url( '/' ) ),
			'issuedAt' => $issued_at,
		);
	}
}
