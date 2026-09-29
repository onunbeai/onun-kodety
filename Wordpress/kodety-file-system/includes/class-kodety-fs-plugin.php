<?php

defined( 'ABSPATH' ) || exit;

final class Kodety_FS_Plugin {
	private static ?Kodety_FS_Plugin $instance = null;
	private Kodety_FS_Database $database;
	private Kodety_FS_Path_Guard $guard;
	private Kodety_FS_Local_Provider $local;
	private Kodety_FS_WordPress_Media_Provider $media;
	private Kodety_FS_Remote_Provider $remote;
	private Kodety_FS_REST_Controller $rest;

	private function __construct() {
		// Credential migration must happen before the remote adapter is created on
		// every request. admin_init does not run for every front-end/REST bootstrap.
		self::migrate_legacy_remote_token();
		$this->database = new Kodety_FS_Database();
		$this->guard    = new Kodety_FS_Path_Guard();
		$this->local    = new Kodety_FS_Local_Provider( $this->database, $this->guard );
		$this->media    = new Kodety_FS_WordPress_Media_Provider();
		$this->remote   = new Kodety_FS_Remote_Provider( self::settings( true ) );
		$this->rest     = new Kodety_FS_REST_Controller( $this->database, $this->guard, $this->local, $this->media, $this->remote );

		add_action( 'init', array( $this, 'register_rewrite' ) );
		add_filter( 'query_vars', array( $this, 'query_vars' ) );
		add_filter( 'template_include', array( $this, 'template_include' ), PHP_INT_MAX );
		add_action( 'rest_api_init', array( $this->rest, 'register_routes' ) );
		add_action( 'admin_menu', array( $this, 'admin_menu' ) );
		add_action( 'admin_init', array( $this, 'maybe_upgrade' ) );
		add_action( 'kodety_fs_cleanup_uploads', array( __CLASS__, 'cleanup_uploads' ) );
	}

	public static function instance(): Kodety_FS_Plugin {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	public static function activate(): void {
		if ( version_compare( PHP_VERSION, '8.0', '<' ) ) {
			deactivate_plugins( plugin_basename( KODETY_FS_FILE ) );
			wp_die( esc_html__( 'Onun Kodety File System requires PHP 8.0 or newer.', 'kodety-file-system' ) );
		}

		$all = array(
			'kodety_files_read',
			'kodety_files_upload',
			'kodety_files_edit',
			'kodety_files_delete',
			'kodety_files_manage_private',
			'kodety_files_edit_code',
			'kodety_files_share',
			'kodety_files_purge',
			'kodety_files_manage_storage',
			'kodety_files_view_audit',
		);
		$administrator = get_role( 'administrator' );
		if ( $administrator ) {
			foreach ( $all as $capability ) {
				$administrator->add_cap( $capability );
			}
		}
		$editor = get_role( 'editor' );
		if ( $editor ) {
			foreach ( array( 'kodety_files_read', 'kodety_files_upload', 'kodety_files_edit' ) as $capability ) {
				$editor->add_cap( $capability );
			}
		}

		Kodety_FS_Database::install();
		Kodety_FS_Local_Provider::initialize_storage();
		if ( false === get_option( 'kodety_fs_settings', false ) ) {
			add_option( 'kodety_fs_settings', array( 'mode' => 'local', 'remote_url' => '', 'remote_token' => '', 'remote_signing_secret' => '' ), '', false );
		}
		self::migrate_legacy_remote_token();
		if ( ! wp_next_scheduled( 'kodety_fs_cleanup_uploads' ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'hourly', 'kodety_fs_cleanup_uploads' );
		}
		self::register_rewrite_static();
		flush_rewrite_rules();
	}

	public static function deactivate(): void {
		wp_clear_scheduled_hook( 'kodety_fs_cleanup_uploads' );
		flush_rewrite_rules();
	}

	public function maybe_upgrade(): void {
		if ( KODETY_FS_VERSION !== get_option( 'kodety_fs_db_version' ) && current_user_can( 'manage_options' ) ) {
			Kodety_FS_Database::install();
			Kodety_FS_Local_Provider::initialize_storage();
		}
		if ( current_user_can( 'kodety_files_manage_storage' ) || current_user_can( 'manage_options' ) ) {
			self::migrate_legacy_remote_token();
		}
	}

	/** Remove only known files from expired, UUID-named upload sessions. */
	public static function cleanup_uploads(): void {
		if ( ! Kodety_FS_Local_Provider::private_storage_available() ) {
			return;
		}
		$root = untrailingslashit( wp_normalize_path( Kodety_FS_Local_Provider::system_storage_root() ) ) . '/uploads';
		if ( ! is_dir( $root ) || is_link( $root ) ) {
			return;
		}
		$expires_before = time() - DAY_IN_SECONDS;
		foreach ( new FilesystemIterator( $root, FilesystemIterator::SKIP_DOTS ) as $entry ) {
			if ( $entry->isLink() || ! $entry->isDir() || ! preg_match( '/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/', $entry->getFilename() ) ) {
				continue;
			}
			$directory = wp_normalize_path( $entry->getPathname() );
			$lock_path = $directory . '/.lock';
			if ( is_link( $lock_path ) ) { continue; }
			$lock = @fopen( $lock_path, 'c+b' );
			if ( false === $lock || ! flock( $lock, LOCK_EX | LOCK_NB ) ) {
				if ( is_resource( $lock ) ) { fclose( $lock ); }
				continue;
			}
			$meta_path = $directory . '/meta.json';
			$meta_handle = is_file( $meta_path ) && ! is_link( $meta_path ) ? @fopen( $meta_path, 'rb' ) : false;
			$meta_json = false;
			if ( false !== $meta_handle && flock( $meta_handle, LOCK_SH ) ) {
				$meta_json = stream_get_contents( $meta_handle );
				flock( $meta_handle, LOCK_UN );
			}
			if ( is_resource( $meta_handle ) ) { fclose( $meta_handle ); }
			$meta = is_string( $meta_json ) ? json_decode( $meta_json, true ) : null;
			$updated_at = is_array( $meta ) ? (int) ( $meta['updatedAt'] ?? $meta['createdAt'] ?? 0 ) : (int) $entry->getMTime();
			if ( $updated_at >= $expires_before ) {
				flock( $lock, LOCK_UN ); fclose( $lock );
				continue;
			}
			foreach ( array( 'payload.part', 'meta.json' ) as $filename ) {
				$file = $directory . '/' . $filename;
				if ( is_file( $file ) && ! is_link( $file ) ) {
					@unlink( $file ); // phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink
				}
			}
			flock( $lock, LOCK_UN ); fclose( $lock );
			@unlink( $lock_path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink
			@rmdir( $directory ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir
		}
	}

	private static function register_rewrite_static(): void {
		add_rewrite_rule( '^kodety-files/?$', 'index.php?kodety_fs_app=1', 'top' );
	}

	public function register_rewrite(): void {
		self::register_rewrite_static();
	}

	public function query_vars( array $vars ): array {
		$vars[] = 'kodety_fs_app';
		return $vars;
	}

	public function is_app_request(): bool {
		if ( '1' === (string) get_query_var( 'kodety_fs_app' ) ) {
			return true;
		}
		return isset( $_GET['kodety_fs_app'] ) && '1' === sanitize_text_field( wp_unslash( $_GET['kodety_fs_app'] ) );
	}

	public function template_include( string $template ): string {
		if ( ! $this->is_app_request() ) {
			return $template;
		}
		if ( ! is_user_logged_in() ) {
			auth_redirect();
		}
		if ( ! current_user_can( 'kodety_files_read' ) ) {
			wp_die( esc_html__( 'You do not have permission to access Onun Kodety File System.', 'kodety-file-system' ), '', array( 'response' => 403 ) );
		}
		status_header( 200 );
		nocache_headers();
		$asset_origin = self::csp_origin( KODETY_FS_URL );
		$rest_origin  = self::csp_origin( rest_url( '/' ) );
		$script_src   = implode( ' ', array_values( array_unique( array_filter( array( "'self'", $asset_origin ) ) ) ) );
		$connect_src  = implode( ' ', array_values( array_unique( array_filter( array( "'self'", $rest_origin ) ) ) ) );
		header( "Content-Security-Policy: default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'; object-src 'none'; script-src {$script_src}; style-src {$script_src} 'unsafe-inline'; font-src {$script_src}; img-src 'self' data: blob: https:; media-src 'self' blob: https:; frame-src 'self' blob: https:; connect-src {$connect_src}; worker-src 'self' blob:" );
		header( 'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()' );
		header( 'Referrer-Policy: same-origin' );
		header( 'X-Content-Type-Options: nosniff' );
		header( 'X-Frame-Options: SAMEORIGIN' );
		return KODETY_FS_DIR . 'templates/app-shell.php';
	}

	/** Return a CSP source containing only an exact, validated HTTP(S) origin. */
	private static function csp_origin( string $url ): string {
		if ( '' === $url || preg_match( '/[\r\n]/', $url ) ) {
			return '';
		}
		$parts = wp_parse_url( $url );
		if ( ! is_array( $parts ) ) {
			return '';
		}
		$scheme = strtolower( (string) ( $parts['scheme'] ?? '' ) );
		$host   = strtolower( trim( (string) ( $parts['host'] ?? '' ), '[]' ) );
		$port   = isset( $parts['port'] ) ? (int) $parts['port'] : 0;
		if ( ! in_array( $scheme, array( 'http', 'https' ), true ) || '' === $host || $port < 0 || $port > 65535 ) {
			return '';
		}
		$is_ipv6 = false !== filter_var( $host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6 );
		if ( ! $is_ipv6 && ! preg_match( '/^(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|[a-z0-9])$/', $host ) ) {
			return '';
		}
		$authority = $is_ipv6 ? '[' . $host . ']' : $host;
		return $scheme . '://' . $authority . ( $port > 0 ? ':' . $port : '' );
	}

	public function admin_menu(): void {
		$hook = add_menu_page(
			__( 'Onun Kodety File System', 'kodety-file-system' ),
			__( 'Onun Kodety Files', 'kodety-file-system' ),
			'kodety_files_read',
			'kodety-file-system',
			'__return_empty_string',
			'dashicons-portfolio',
			58
		);
		add_action( 'load-' . $hook, array( $this, 'redirect_admin_page' ) );
	}

	public function redirect_admin_page(): void {
		if ( ! current_user_can( 'kodety_files_read' ) ) {
			wp_die( esc_html__( 'You do not have permission to access Onun Kodety File System.', 'kodety-file-system' ), '', array( 'response' => 403 ) );
		}
		wp_safe_redirect( self::app_url() );
		exit;
	}

	public static function app_url(): string {
		return get_option( 'permalink_structure' )
			? home_url( '/kodety-files/' )
			: add_query_arg( 'kodety_fs_app', '1', home_url( '/' ) );
	}

	public function app_config(): array {
		$user = wp_get_current_user();
		return array(
			'version'      => KODETY_FS_VERSION,
			'restUrl'      => untrailingslashit( rest_url( KODETY_FS_REST_NAMESPACE ) ),
			'nonce'        => wp_create_nonce( 'wp_rest' ),
			'appUrl'       => self::app_url(),
			'fileSystemUrl'=> self::app_url(),
			'dashboardUrl' => admin_url(),
			'siteName'     => get_bloginfo( 'name' ) ?: 'Onun Kodety',
			'queryFallback'=> add_query_arg( 'kodety_fs_app', '1', home_url( '/' ) ),
			'user'         => array( 'id' => $user->ID, 'name' => $user->display_name, 'avatarUrl' => get_avatar_url( $user->ID, array( 'size' => 64 ) ) ),
			'capabilities' => self::current_capabilities(),
			'storageHealth'=> Kodety_FS_Local_Provider::storage_health(),
			'features'     => array( 'zip' => class_exists( 'ZipArchive' ), 'chunkUpload' => Kodety_FS_Local_Provider::private_storage_available(), 'versions' => Kodety_FS_Local_Provider::private_storage_available(), 'privateStorage' => Kodety_FS_Local_Provider::private_storage_available(), 'wordpressMedia' => true, 'remote' => $this->remote->configured() ),
		);
	}

	public static function current_capabilities(): array {
		$read           = current_user_can( 'kodety_files_read' );
		$upload         = current_user_can( 'kodety_files_upload' );
		$edit           = current_user_can( 'kodety_files_edit' );
		$delete         = current_user_can( 'kodety_files_delete' );
		$purge          = current_user_can( 'kodety_files_purge' );
		$share          = current_user_can( 'kodety_files_share' );
		$view_audit     = current_user_can( 'kodety_files_view_audit' );
		$manage_private = current_user_can( 'kodety_files_manage_private' );
		$edit_code      = current_user_can( 'kodety_files_edit_code' );
		$dangerous_edit = $edit_code && defined( 'KODETY_FS_ENABLE_DANGEROUS_FILE_EDITING' ) && true === KODETY_FS_ENABLE_DANGEROUS_FILE_EDITING;
		$manage_storage = current_user_can( 'kodety_files_manage_storage' );

		// Keep the original capability names for integrations while publishing the
		// exact camelCase/FilePermissions contract consumed by the standalone UI.
		return array(
			'read'                     => $read,
			'upload'                   => $upload,
			'edit'                     => $edit,
			'write'                    => $edit,
			'create'                   => $edit,
			'delete'                   => $delete,
			'purge'                    => $purge,
			'move'                     => $edit,
			'share'                    => $share,
			'visibility'               => $manage_private,
			'editCode'                 => $edit_code,
			'versions'                 => $read,
			'manage_private'           => $manage_private,
			'managePrivate'            => $manage_private,
			'edit_code'                => $edit_code,
			'dangerousFileEditing'     => $dangerous_edit,
			'manage_storage'           => $manage_storage,
			'manageStorage'            => $manage_storage,
			'rescan'                   => $manage_storage,
			'archive'                  => $edit && class_exists( 'ZipArchive' ),
			'view_audit'               => $view_audit,
			'viewAudit'                => $view_audit,
			'activity'                 => $view_audit,
		);
	}

	public static function settings( bool $include_secret = false ): array {
		$settings = get_option( 'kodety_fs_settings', array() );
		$settings = wp_parse_args( is_array( $settings ) ? $settings : array(), array( 'mode' => 'local', 'remote_url' => '', 'remote_token' => '', 'remote_signing_secret' => '' ) );
		foreach ( array( 'remote_token', 'remote_signing_secret' ) as $secret_key ) {
			$stored = (string) $settings[ $secret_key ];
			// Legacy plaintext is migration input only. Never pass it to a provider
			// or describe it as a usable credential when persistence failed.
			$opened = Kodety_FS_Secret_Box::is_sealed( $stored ) ? Kodety_FS_Secret_Box::open( $stored ) : '';
			if ( ! $include_secret ) {
				$settings[ $secret_key . '_set' ] = '' !== $opened;
				unset( $settings[ $secret_key ] );
			} else {
				$settings[ $secret_key ] = $opened;
			}
		}
		return $settings;
	}

	/** @return array<string,mixed>|WP_Error */
	public static function update_settings( array $input ) {
		$stored = get_option( 'kodety_fs_settings', array() );
		$stored = wp_parse_args( is_array( $stored ) ? $stored : array(), array( 'mode' => 'local', 'remote_url' => '', 'remote_token' => '', 'remote_signing_secret' => '' ) );
		$current = self::settings( true );
		$mode    = in_array( $input['mode'] ?? '', array( 'local', 'remote' ), true ) ? $input['mode'] : $current['mode'];
		$url     = isset( $input['remote_url'] ) ? untrailingslashit( esc_url_raw( (string) $input['remote_url'] ) ) : $current['remote_url'];
		if ( '' !== $url ) {
			$url_validation = Kodety_FS_Remote_Provider::validate_base_url( $url );
			if ( is_wp_error( $url_validation ) ) {
				return $url_validation;
			}
		}
		$plain = array();
		$changed = array();
		foreach ( array( 'remote_token', 'remote_signing_secret' ) as $secret_key ) {
			$changed[ $secret_key ] = array_key_exists( $secret_key, $input );
			$plain[ $secret_key ] = $changed[ $secret_key ] ? trim( (string) $input[ $secret_key ] ) : (string) $current[ $secret_key ];
			if ( ! empty( $input[ 'clear_' . $secret_key ] ) ) {
				$plain[ $secret_key ] = '';
				$changed[ $secret_key ] = true;
			}
			if ( strlen( $plain[ $secret_key ] ) > 4096 || preg_match( '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $plain[ $secret_key ] ) ) {
				return new WP_Error( 'kodety_fs_remote_secret', __( 'A remote API credential is invalid.', 'kodety-file-system' ), array( 'status' => 400 ) );
			}
		}
		if ( 'remote' === $mode && ( '' === $url || strlen( $plain['remote_token'] ) < 24 || strlen( $plain['remote_signing_secret'] ) < 32 ) ) {
			return new WP_Error( 'kodety_fs_remote_credentials', __( 'Remote mode requires an HTTPS URL, an access token, and a separate signing secret of at least 32 characters.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		if ( '' !== $plain['remote_token'] && '' !== $plain['remote_signing_secret'] && hash_equals( $plain['remote_token'], $plain['remote_signing_secret'] ) ) {
			return new WP_Error( 'kodety_fs_remote_secret_reuse', __( 'The access token and request-signing secret must be different.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		try {
			$sealed = array();
			foreach ( array( 'remote_token', 'remote_signing_secret' ) as $secret_key ) {
				$sealed[ $secret_key ] = $changed[ $secret_key ] || ! Kodety_FS_Secret_Box::is_sealed( (string) $stored[ $secret_key ] )
					? Kodety_FS_Secret_Box::seal( $plain[ $secret_key ] )
					: (string) $stored[ $secret_key ];
			}
		} catch ( RuntimeException $exception ) {
			return new WP_Error( 'kodety_fs_secret_encryption', __( 'The server cannot securely store the remote API credentials.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		$updated = update_option( 'kodety_fs_settings', array( 'mode' => $mode, 'remote_url' => $url, 'remote_token' => $sealed['remote_token'], 'remote_signing_secret' => $sealed['remote_signing_secret'] ), false );
		if ( ! $updated && get_option( 'kodety_fs_settings', array() ) !== array( 'mode' => $mode, 'remote_url' => $url, 'remote_token' => $sealed['remote_token'], 'remote_signing_secret' => $sealed['remote_signing_secret'] ) ) {
			return new WP_Error( 'kodety_fs_settings_write', __( 'The remote settings could not be persisted.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		return self::settings( false );
	}

	private static function migrate_legacy_remote_token(): bool {
		$settings = get_option( 'kodety_fs_settings', array() );
		if ( ! is_array( $settings ) ) {
			return true;
		}
		$updated = false;
		foreach ( array( 'remote_token', 'remote_signing_secret' ) as $secret_key ) {
			$value = (string) ( $settings[ $secret_key ] ?? '' );
			if ( '' === $value || Kodety_FS_Secret_Box::is_sealed( $value ) ) {
				continue;
			}
			try {
				$settings[ $secret_key ] = Kodety_FS_Secret_Box::seal( $value );
				$updated = true;
			} catch ( RuntimeException $exception ) {
				$settings[ $secret_key ] = '';
				$settings['mode'] = 'local';
				$updated = true;
				update_option( 'kodety_fs_secret_migration_failed', time(), false );
			}
		}
		if ( $updated ) {
			$persisted = update_option( 'kodety_fs_settings', $settings, false );
			if ( ! $persisted && get_option( 'kodety_fs_settings', array() ) !== $settings ) {
				update_option( 'kodety_fs_secret_migration_failed', time(), false );
				return false;
			}
		}
		return true;
	}

	public function local_provider(): Kodety_FS_Local_Provider {
		return $this->local;
	}
}
