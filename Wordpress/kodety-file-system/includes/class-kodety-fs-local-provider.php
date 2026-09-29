<?php

defined( 'ABSPATH' ) || exit;

final class Kodety_FS_Local_Provider implements Kodety_FS_Storage_Provider {
	private const PASSIVE_PUBLIC_EXTENSIONS = array(
		'jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp', 'ico', 'tif', 'tiff',
		'mp4', 'webm', 'mov', 'm4v', 'ogv', 'mp3', 'wav', 'ogg', 'oga', 'm4a',
		'aac', 'flac', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'pdf', 'zip', 'gz',
		'tar', '7z', 'rar', 'css', 'json', 'txt', 'md', 'csv', 'webmanifest', 'wasm',
	);
	private const CODE_MUTATION_EXTENSIONS = array(
		'html', 'htm', 'xht', 'xhtm', 'xhtml', 'shtm', 'shtml', 'css', 'scss', 'sass', 'less',
		'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'json', 'jsonc', 'svg', 'xml', 'xsl', 'xslt',
		'yaml', 'yml', 'webmanifest', 'wasm', 'php', 'php3', 'php4', 'php5', 'php7', 'php8',
		'phtml', 'phar', 'env', 'ini', 'htaccess', 'user.ini', 'sh', 'bash', 'zsh', 'ps1',
		'cgi', 'pl', 'py', 'rb',
	);
	private Kodety_FS_Database $database;
	private Kodety_FS_Path_Guard $guard;
	private string $root;
	private string $private_root;
	private string $system_root;
	/** @var resource|null */
	private $mutation_lock = null;
	private ?string $capacity_reservation_exclusion = null;
	/** @var array<string,string> */
	private array $mounts;

	public function __construct( Kodety_FS_Database $database, Kodety_FS_Path_Guard $guard ) {
		$this->database = $database;
		$this->guard    = $guard;
		$this->root     = self::storage_root();
		$this->private_root = self::private_storage_root();
		$this->system_root  = self::system_storage_root();
		$this->mounts       = array( 'public' => $this->root . '/public' );
		if ( self::private_storage_available() ) {
			$this->mounts = array(
				'project' => $this->private_root . '/projects/default',
				'public'  => $this->root . '/public',
				'private' => $this->private_root . '/private',
				'imports' => $this->private_root . '/imports',
			);
		}
	}

	public function __destruct() {
		$this->end_storage_allocation();
	}

	/** @return true|WP_Error */
	public function begin_storage_allocation() {
		return $this->acquire_mutation_lock();
	}

	public function end_storage_allocation(): void {
		if ( is_resource( $this->mutation_lock ) ) {
			flock( $this->mutation_lock, LOCK_UN );
			fclose( $this->mutation_lock );
		}
		$this->mutation_lock = null;
	}

	/** @return true|WP_Error */
	public function check_storage_capacity( int $peak_bytes, string $target, int $quota_growth = 0 ) {
		return $this->ensure_capacity( $peak_bytes, $target, $quota_growth );
	}

	public static function storage_root(): string {
		$uploads = wp_upload_dir();
		$fallback = trailingslashit( $uploads['basedir'] ) . 'kodety-file-system';
		if ( defined( 'KODETY_FS_STORAGE_ROOT' ) && is_string( KODETY_FS_STORAGE_ROOT ) && '' !== KODETY_FS_STORAGE_ROOT ) {
			$root = KODETY_FS_STORAGE_ROOT;
		} else {
			$root = $fallback;
		}
		$root = untrailingslashit( wp_normalize_path( (string) apply_filters( 'kodety_fs_storage_root', $root ) ) );
		return self::safe_storage_path( $root ) ? $root : untrailingslashit( wp_normalize_path( $fallback ) );
	}

	/**
	 * Returns the non-public root. A single explicit storage root keeps the
	 * bind-mount layout requested by container deployments; portable installs
	 * default to a site-specific sibling of the WordPress document root.
	 */
	public static function private_storage_root(): string {
		if ( defined( 'KODETY_FS_PRIVATE_ROOT' ) && is_string( KODETY_FS_PRIVATE_ROOT ) && '' !== KODETY_FS_PRIVATE_ROOT ) {
			$root = KODETY_FS_PRIVATE_ROOT;
		} elseif ( defined( 'KODETY_FS_STORAGE_ROOT' ) && is_string( KODETY_FS_STORAGE_ROOT ) && '' !== KODETY_FS_STORAGE_ROOT ) {
			$root = KODETY_FS_STORAGE_ROOT;
		} else {
			$identity = function_exists( 'site_url' ) ? site_url( '/' ) : ABSPATH;
			$document_root = isset( $_SERVER['DOCUMENT_ROOT'] ) ? wp_normalize_path( (string) $_SERVER['DOCUMENT_ROOT'] ) : '';
			$document_root = '' !== $document_root && is_dir( $document_root ) ? $document_root : ABSPATH;
			$root = dirname( untrailingslashit( wp_normalize_path( $document_root ) ) ) . '/kodety-file-system-private-' . substr( hash( 'sha256', $identity ), 0, 12 );
		}
		$root = untrailingslashit( wp_normalize_path( (string) apply_filters( 'kodety_fs_private_storage_root', $root ) ) );
		if ( self::safe_storage_path( $root ) ) {
			return $root;
		}
		$identity = function_exists( 'site_url' ) ? site_url( '/' ) : ABSPATH;
		$fallback = dirname( untrailingslashit( wp_normalize_path( ABSPATH ) ) ) . '/kodety-file-system-private-' . substr( hash( 'sha256', $identity ), 0, 12 );
		return untrailingslashit( wp_normalize_path( $fallback ) );
	}

	private static function safe_storage_path( string $root, bool $dedicated_root = true ): bool {
		$root = untrailingslashit( wp_normalize_path( $root ) );
		if ( '' === $root || '/' === $root || preg_match( '/^[a-z]:$/i', $root ) || str_contains( $root, "\0" ) || preg_match( '#(?:^|/)\.\.?(/|$)#', $root ) || ! str_starts_with( $root, '/' ) && ! preg_match( '/^[a-z]:\//i', $root ) ) {
			return false;
		}
		$broad = array( ABSPATH, dirname( untrailingslashit( ABSPATH ) ) );
		if ( defined( 'WP_CONTENT_DIR' ) ) { $broad[] = WP_CONTENT_DIR; }
		if ( ! empty( $_SERVER['DOCUMENT_ROOT'] ) ) { $broad[] = (string) $_SERVER['DOCUMENT_ROOT']; }
		foreach ( $broad as $path ) {
			$path = untrailingslashit( wp_normalize_path( (string) $path ) );
			if ( '' !== $path && $root === $path ) { return false; }
		}
		$basename = strtolower( wp_basename( $root ) );
		if ( $dedicated_root && in_array( $basename, array( '', 'srv', 'var', 'www', 'html', 'public_html', 'htdocs', 'home', 'users', 'wordpress', 'wp-content', 'uploads' ), true ) ) {
			return false;
		}
		if ( is_link( $root ) || file_exists( $root ) && ! is_dir( $root ) ) { return false; }
		$ancestor = $root;
		while ( ! file_exists( $ancestor ) ) {
			$parent = dirname( $ancestor );
			if ( $parent === $ancestor || '.' === $parent ) { return false; }
			$ancestor = $parent;
		}
		$resolved_ancestor = realpath( $ancestor );
		if ( false === $resolved_ancestor || ! is_dir( $resolved_ancestor ) ) { return false; }
		$cursor = $root;
		while ( '/' !== $cursor && ! preg_match( '/^[a-z]:\/?$/i', $cursor ) ) {
			if ( is_link( $cursor ) && '/' !== dirname( $cursor ) ) { return false; }
			$parent = dirname( $cursor );
			if ( $parent === $cursor ) { break; }
			$cursor = $parent;
		}
		return true;
	}

	public static function system_storage_root(): string {
		return self::private_storage_root();
	}

	public static function private_storage_available(): bool {
		$root = self::private_storage_root();
		if ( ! is_dir( $root ) || ! is_readable( $root ) || ! is_writable( $root ) || is_link( $root ) ) {
			return false;
		}
		$root_real = realpath( $root );
		$document_roots = array( ABSPATH );
		if ( isset( $_SERVER['DOCUMENT_ROOT'] ) && is_string( $_SERVER['DOCUMENT_ROOT'] ) && '' !== $_SERVER['DOCUMENT_ROOT'] ) {
			$document_roots[] = $_SERVER['DOCUMENT_ROOT'];
		}
		if ( false === $root_real ) {
			return false;
		}
		$root_real = untrailingslashit( wp_normalize_path( $root_real ) );
		$inside_document_root = false;
		$document_real = untrailingslashit( wp_normalize_path( ABSPATH ) );
		foreach ( $document_roots as $document_root ) {
			$resolved_document = realpath( $document_root );
			if ( false === $resolved_document ) {
				continue;
			}
			$document_real = untrailingslashit( wp_normalize_path( $resolved_document ) );
			if ( $root_real === $document_real || str_starts_with( $root_real, $document_real . '/' ) ) {
				$inside_document_root = true;
				break;
			}
		}
		$allow_insecure = defined( 'KODETY_FS_ALLOW_INSECURE_PRIVATE' ) && true === KODETY_FS_ALLOW_INSECURE_PRIVATE;
		$allow_insecure = (bool) apply_filters( 'kodety_fs_allow_insecure_private_storage', $allow_insecure, $root_real, $document_real );
		return ! $inside_document_root || $allow_insecure;
	}

	public static function storage_health(): array {
		$private_available = self::private_storage_available();
		$audit_degraded = (bool) get_option( 'kodety_fs_audit_degraded', false );
		$public_audit = get_option( 'kodety_fs_public_storage_audit', array() );
		$shared_root_conflict = get_option( 'kodety_fs_shared_root_protection_conflict', array() );
		$shared_root_healthy = is_array( $shared_root_conflict ) && empty( $shared_root_conflict['files'] );
		$scan_interval = max( 60, (int) apply_filters( 'kodety_fs_public_audit_interval', 300 ) );
		if ( ! is_array( $public_audit ) || time() - (int) ( $public_audit['scannedAt'] ?? 0 ) >= $scan_interval ) {
			$public_audit = self::audit_public_storage( false );
		}
		$public_policy_healthy = is_array( $public_audit )
			&& empty( $public_audit['remainingUnsafe'] )
			&& empty( $public_audit['failures'] )
			&& empty( $public_audit['truncated'] );
		$warnings = array();
		if ( ! $private_available ) { $warnings[] = __( 'Private storage is disabled because a writable root outside the public document root is unavailable. Configure KODETY_FS_PRIVATE_ROOT to enable it safely.', 'kodety-file-system' ); }
		if ( $audit_degraded ) { $warnings[] = __( 'The audit log could not be written. Check the Onun Kodety File System database tables.', 'kodety-file-system' ); }
		if ( ! $public_policy_healthy ) { $warnings[] = __( 'The bounded public-storage audit found unsafe legacy content, could not inspect every entry, or could not quarantine an unsafe item. Review the public storage root before serving it.', 'kodety-file-system' ); }
		if ( is_array( $shared_root_conflict ) && ! empty( $shared_root_conflict['files'] ) ) { $warnings[] = __( 'A custom deny rule remains at the shared storage root and may prevent public assets from being served. It was preserved because it is not an exact Kodety-managed file.', 'kodety-file-system' ); }
		return array(
			'publicAvailable'  => is_dir( self::storage_root() . '/public' ) && is_writable( self::storage_root() . '/public' ),
			'privateAvailable' => $private_available,
			'auditAvailable'   => ! $audit_degraded,
			'publicPolicyHealthy' => $public_policy_healthy,
			'publicAudit'      => is_array( $public_audit ) ? $public_audit : array(),
			'sharedRootProtectionConflict' => is_array( $shared_root_conflict ) ? $shared_root_conflict : array(),
			'status'           => $private_available && ! $audit_degraded && $public_policy_healthy && $shared_root_healthy ? 'healthy' : 'degraded',
			'warning'          => empty( $warnings ) ? null : implode( ' ', $warnings ),
		);
	}

	public static function initialize_storage(): void {
		$root         = self::storage_root();
		$private_root = self::private_storage_root();
		$directories = array( $root, "$root/public", $private_root, "$private_root/projects/default", "$private_root/private", "$private_root/imports", "$private_root/trash", "$private_root/versions", "$private_root/temp", "$private_root/uploads" );
		if ( ! self::safe_storage_path( $root ) || ! self::safe_storage_path( $private_root ) ) { return; }
		foreach ( $directories as $directory ) {
			if ( ! self::safe_storage_path( $directory, false ) ) { return; }
		}
		foreach ( $directories as $directory ) {
			wp_mkdir_p( $directory );
			if ( is_link( $directory ) || ! is_dir( $directory ) ) { return; }
		}
		$root_real = realpath( $root );
		$private_real = realpath( $private_root );
		$shared_root = false !== $root_real && false !== $private_real
			&& untrailingslashit( wp_normalize_path( $root_real ) ) === untrailingslashit( wp_normalize_path( $private_real ) );
		@chmod( $root, 0755 );
		@chmod( "$root/public", 0755 );
		$private_directories = array( "$private_root/projects", "$private_root/projects/default", "$private_root/private", "$private_root/imports", "$private_root/trash", "$private_root/versions", "$private_root/temp", "$private_root/uploads" );
		if ( ! $shared_root ) {
			array_unshift( $private_directories, $private_root );
		}
		foreach ( $private_directories as $private_directory ) {
			if ( is_dir( $private_directory ) ) {
				@chmod( $private_directory, 0750 );
			}
		}

		$deny = "# Onun Kodety File System\n<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n";
		$webconfig_deny = '<?xml version="1.0" encoding="UTF-8"?><configuration><system.webServer><security><authorization><remove users="*" roles="" verbs=""/><add accessType="Deny" users="*"/></authorization></security></system.webServer></configuration>';
		$protected_private_directories = array( "$private_root/projects", "$private_root/projects/default", "$private_root/private", "$private_root/imports", "$private_root/trash", "$private_root/versions", "$private_root/temp", "$private_root/uploads" );
		if ( ! $shared_root ) {
			array_unshift( $protected_private_directories, $private_root );
		} else {
			self::remove_protection_file_if_exact( "$private_root/.htaccess", $deny );
			self::remove_protection_file_if_exact( "$private_root/web.config", $webconfig_deny );
			self::remove_protection_file_if_exact( "$private_root/index.php", "<?php\nhttp_response_code( 403 );\nexit;\n" );
			$conflicts = array();
			foreach ( array( '.htaccess', 'web.config' ) as $root_config ) {
				$config_path = "$private_root/$root_config";
				$config = is_file( $config_path ) && ! is_link( $config_path ) && (int) @filesize( $config_path ) <= 64 * KB_IN_BYTES ? @file_get_contents( $config_path ) : false; // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
				if ( is_string( $config ) && preg_match( '/(?:Require\s+all\s+denied|Deny\s+from\s+all|accessType\s*=\s*["\x27]Deny["\x27]\s+users\s*=\s*["\x27]\*["\x27])/i', $config ) ) {
					$conflicts[] = $root_config;
				}
			}
			update_option( 'kodety_fs_shared_root_protection_conflict', array( 'files' => $conflicts, 'checkedAt' => time() ), false );
		}
		if ( ! $shared_root ) {
			update_option( 'kodety_fs_shared_root_protection_conflict', array( 'files' => array(), 'checkedAt' => time() ), false );
		}
		foreach ( $protected_private_directories as $private_dir ) {
			if ( ! is_dir( $private_dir ) ) {
				continue;
			}
			self::write_protection_file( "$private_dir/.htaccess", $deny );
			self::write_protection_file( "$private_dir/web.config", $webconfig_deny );
			self::write_protection_file( "$private_dir/index.php", "<?php\nhttp_response_code( 403 );\nexit;\n" );
		}

		foreach ( self::public_protection_files() as $filename => $content ) {
			self::write_protection_file( "$root/public/$filename", $content );
		}
		self::audit_public_storage( true );
	}

	/** @return array<string,string> */
	private static function public_protection_files(): array {
		return array(
			'.htaccess' => "# Onun Kodety File System: never execute uploaded scripts\n<FilesMatch \"\\.(php[0-9]?|phtml|phar|cgi|pl|py|rb|sh|asp|aspx|asa|asax|ashx|asmx|axd|svc|cshtml|vbhtml)$\">\n<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nOrder allow,deny\nDeny from all\n</IfModule>\n</FilesMatch>\n<IfModule mod_headers.c>\nHeader always set X-Content-Type-Options \"nosniff\"\n</IfModule>\n",
			'web.config' => '<?xml version="1.0" encoding="UTF-8"?><configuration><system.webServer><directoryBrowse enabled="false"/><handlers accessPolicy="Read"/><httpProtocol><customHeaders><remove name="X-Content-Type-Options"/><add name="X-Content-Type-Options" value="nosniff"/></customHeaders></httpProtocol></system.webServer></configuration>',
			'index.php' => "<?php\nhttp_response_code( 403 );\nexit;\n",
		);
	}

	private static function write_protection_file( string $path, string $content ): void {
		if ( is_link( $path ) ) {
			return;
		}
		$current = is_file( $path ) && ! is_link( $path ) ? @file_get_contents( $path ) : false; // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		if ( ! is_string( $current ) || ! hash_equals( hash( 'sha256', $content ), hash( 'sha256', $current ) ) ) {
			@file_put_contents( $path, $content, LOCK_EX ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		}
		@chmod( $path, 0644 );
	}

	private static function remove_protection_file_if_exact( string $path, string $expected_content ): void {
		if ( ! is_file( $path ) || is_link( $path ) ) {
			return;
		}
		$current = @file_get_contents( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		if ( is_string( $current ) && hash_equals( hash( 'sha256', $expected_content ), hash( 'sha256', $current ) ) ) {
			@unlink( $path );
		}
	}

	/**
	 * Inspect public storage without following links. Activation/update runs may
	 * quarantine unsafe legacy entries; health checks only report them. Both
	 * modes are bounded by an item count and wall-clock deadline.
	 *
	 * @return array<string,mixed>
	 */
	public static function audit_public_storage( bool $quarantine = false ): array {
		$public_root = self::storage_root() . '/public';
		$result = array(
			'scannedAt'       => time(),
			'visited'         => 0,
			'unsafeFound'     => 0,
			'quarantined'     => 0,
			'remainingUnsafe' => 0,
			'failures'        => 0,
			'truncated'       => false,
		);
		if ( ! is_dir( $public_root ) || is_link( $public_root ) ) {
			$result['failures'] = 1;
			update_option( 'kodety_fs_public_storage_audit', $result, false );
			return $result;
		}
		$limit = min( 100000, max( 100, (int) apply_filters( 'kodety_fs_public_audit_limit', 5000 ) ) );
		$deadline = microtime( true ) + min( 10.0, max( 0.25, (float) apply_filters( 'kodety_fs_public_audit_deadline_seconds', 2.0 ) ) );
		$guard = new Kodety_FS_Path_Guard();
		$root = untrailingslashit( wp_normalize_path( $public_root ) );
		$directories = array( $public_root );
		$directory_index = 0;
		$protected_root_files = self::public_protection_files();

		try {
			while ( isset( $directories[ $directory_index ] ) ) {
				if ( microtime( true ) >= $deadline ) {
					$result['truncated'] = true;
					break;
				}
				foreach ( new FilesystemIterator( $directories[ $directory_index++ ], FilesystemIterator::SKIP_DOTS ) as $entry ) {
					if ( ++$result['visited'] > $limit || microtime( true ) >= $deadline ) {
						$result['truncated'] = true;
						break 2;
					}
					$absolute = wp_normalize_path( $entry->getPathname() );
					$relative = ltrim( substr( $absolute, strlen( $root ) ), '/' );
					if ( '' === $relative || ! $guard->is_within( $root, $absolute ) ) {
						++$result['failures'];
						continue;
					}
					if ( $entry->isDir() && ! $entry->isLink() ) {
						$directories[] = $entry->getPathname();
						continue;
					}
					$root_filename = strtolower( $relative );
					if ( ! str_contains( $relative, '/' ) && isset( $protected_root_files[ $root_filename ] ) ) {
						$current = ! $entry->isLink() && $entry->isFile() ? @file_get_contents( $entry->getPathname() ) : false; // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
						if ( is_string( $current ) && hash_equals( hash( 'sha256', $protected_root_files[ $root_filename ] ), hash( 'sha256', $current ) ) ) {
							continue;
						}
					}
					$stat = @lstat( $entry->getPathname() );
					$unsafe = $entry->isLink() || ! $entry->isFile() || ! is_array( $stat ) || (int) ( $stat['nlink'] ?? 1 ) > 1;
					if ( ! $unsafe ) {
						$mime = self::detect_public_mime( $entry->getPathname(), $relative );
						$unsafe = is_wp_error( self::validate_public_asset_policy( $guard, self::storage_root(), $relative, $mime ) );
						if ( ! $unsafe && 'svg' === strtolower( pathinfo( $relative, PATHINFO_EXTENSION ) ) ) {
							$svg_size = (int) ( $stat['size'] ?? 0 );
							$svg = $svg_size >= 0 && $svg_size <= 10 * MB_IN_BYTES ? @file_get_contents( $entry->getPathname() ) : false; // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
							$sanitized_svg = is_string( $svg ) ? $guard->sanitize_svg( $svg ) : new WP_Error( 'kodety_fs_svg_too_large' );
							$unsafe = is_wp_error( $sanitized_svg ) || ! hash_equals( hash( 'sha256', $svg ), hash( 'sha256', $sanitized_svg ) );
						}
					}
					if ( ! $unsafe ) {
						continue;
					}
					++$result['unsafeFound'];
					if ( $quarantine && self::private_storage_available() && self::quarantine_public_entry( $entry->getPathname(), $relative, $deadline ) ) {
						++$result['quarantined'];
					} else {
						++$result['remainingUnsafe'];
						if ( $quarantine ) { ++$result['failures']; }
					}
				}
			}
		} catch ( UnexpectedValueException $exception ) {
			$result['truncated'] = true;
			++$result['failures'];
		}
		update_option( 'kodety_fs_public_storage_audit', $result, false );
		return $result;
	}

	private static function detect_public_mime( string $absolute, string $name ): string {
		if ( 'svg' === strtolower( pathinfo( $name, PATHINFO_EXTENSION ) ) ) {
			return 'image/svg+xml';
		}
		if ( function_exists( 'finfo_open' ) ) {
			$finfo = finfo_open( FILEINFO_MIME_TYPE );
			$mime = $finfo ? finfo_file( $finfo, $absolute ) : false;
			if ( $finfo ) { finfo_close( $finfo ); }
			if ( is_string( $mime ) && '' !== $mime ) {
				return $mime;
			}
		}
		$type = wp_check_filetype( $name );
		return $type['type'] ?: 'application/octet-stream';
	}

	private static function quarantine_public_entry( string $source, string $relative, float $deadline ): bool {
		if ( microtime( true ) >= $deadline || ! file_exists( $source ) && ! is_link( $source ) ) {
			return false;
		}
		$quarantine_root = self::private_storage_root() . '/imports/quarantine/public-legacy';
		if ( ! wp_mkdir_p( $quarantine_root ) || is_link( $quarantine_root ) ) {
			return false;
		}
		@chmod( $quarantine_root, 0750 );
		$basename = sanitize_file_name( wp_basename( $relative ) );
		$basename = '' === $basename ? 'unsafe-entry' : $basename;
		$destination = $quarantine_root . '/' . hash( 'sha256', $relative ) . '-' . $basename;
		if ( file_exists( $destination ) || is_link( $destination ) ) {
			$destination .= '-' . wp_generate_uuid4();
		}
		if ( @rename( $source, $destination ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.rename_rename
			@chmod( $destination, 0640 );
			return true;
		}
		if ( is_link( $source ) || ! is_file( $source ) ) {
			return false;
		}
		$stat = @lstat( $source );
		$size = is_array( $stat ) ? max( 0, (int) ( $stat['size'] ?? 0 ) ) : -1;
		$copy_limit = max( MB_IN_BYTES, (int) apply_filters( 'kodety_fs_public_quarantine_copy_limit', 128 * MB_IN_BYTES ) );
		$free = @disk_free_space( $quarantine_root );
		if ( $size < 0 || $size > $copy_limit || false === $free || $size + 64 * MB_IN_BYTES > $free ) {
			return false;
		}
		$input = @fopen( $source, 'rb' );
		$output = @fopen( $destination, 'xb' );
		if ( false === $input || false === $output ) {
			if ( is_resource( $input ) ) { fclose( $input ); }
			if ( is_resource( $output ) ) { fclose( $output ); }
			@unlink( $destination );
			return false;
		}
		$locked = flock( $output, LOCK_EX );
		$copied = 0;
		$source_hash = hash_init( 'sha256' );
		$ok = $locked;
		while ( $ok && ! feof( $input ) ) {
			if ( microtime( true ) >= $deadline ) { $ok = false; break; }
			$chunk = fread( $input, MB_IN_BYTES );
			if ( false === $chunk ) { $ok = false; break; }
			if ( '' === $chunk ) { continue; }
			hash_update( $source_hash, $chunk );
			$length = strlen( $chunk );
			$offset = 0;
			while ( $offset < $length ) {
				$written = fwrite( $output, substr( $chunk, $offset ) );
				if ( false === $written || 0 === $written ) { $ok = false; break; }
				$offset += $written;
				$copied += $written;
			}
		}
		$ok = $ok && $copied === $size && fflush( $output );
		if ( $ok && function_exists( 'fsync' ) ) { $ok = fsync( $output ); }
		if ( $locked ) { flock( $output, LOCK_UN ); }
		fclose( $input );
		fclose( $output );
		$expected_hash = hash_final( $source_hash );
		$ok = $ok && hash_equals( $expected_hash, (string) @hash_file( 'sha256', $destination ) );
		if ( ! $ok || ! @unlink( $source ) ) {
			@unlink( $destination );
			return false;
		}
		@chmod( $destination, 0640 );
		return true;
	}

	public function get_id(): string {
		return 'local';
	}

	public function get_label(): string {
		return __( 'Local storage', 'kodety-file-system' );
	}

	public function get_capabilities(): array {
		$system_available = self::private_storage_available();
		return array(
			'list' => true, 'read' => true, 'write' => true, 'upload' => true,
			'delete' => $system_available, 'move' => true, 'copy' => true, 'versions' => $system_available,
			'visibility' => true, 'archives' => class_exists( 'ZipArchive' ),
		);
	}

	/** @return array<string,string> */
	public function mount_roots(): array {
		return $this->mounts;
	}

	public function mount_descriptors(): array {
		$out = array();
		foreach ( $this->mounts as $id => $root ) {
			$out[] = array(
				'id'          => $id,
				'label'       => ucfirst( $id ),
				'name'        => ucfirst( $id ),
				'provider'    => 'local',
				'visibility'  => 'public' === $id ? 'public' : 'private',
				'permissions' => $this->permissions_for_mount( $id ),
			);
		}
		return $out;
	}

	/** @return string|WP_Error */
	public function mount_root( string $mount ) {
		$mount = sanitize_key( $mount );
		if ( ! isset( $this->mounts[ $mount ] ) ) {
			return new WP_Error( 'kodety_fs_unknown_mount', __( 'Unknown storage mount.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		return $this->mounts[ $mount ];
	}

	public function list( array $args ) {
		$mount = sanitize_key( (string) ( $args['mount'] ?? 'project' ) );
		$path  = $this->guard->normalize_relative( (string) ( $args['path'] ?? '' ), true );
		if ( is_wp_error( $path ) ) {
			return $path;
		}
		$root = $this->mount_root( $mount );
		if ( is_wp_error( $root ) ) {
			return $root;
		}

		$query    = substr( trim( sanitize_text_field( (string) ( $args['query'] ?? '' ) ) ), 0, 190 );
		$scope    = sanitize_key( (string) ( $args['scope'] ?? 'folder' ) );
		$page     = max( 1, (int) ( $args['page'] ?? 1 ) );
		$per_page = min( 200, max( 1, (int) ( $args['per_page'] ?? 100 ) ) );
		$candidates = array();
		$truncated  = false;
		$visited    = 0;
		$deadline   = microtime( true ) + min( 10.0, max( 0.25, (float) apply_filters( 'kodety_fs_list_deadline_seconds', 2.0 ) ) );

		if ( '' !== $query || 'recursive' === $scope ) {
			$base = $this->guard->resolve( $root, $path, true );
			if ( is_wp_error( $base ) ) {
				return $base;
			}
			if ( ! is_dir( $base ) ) {
				return new WP_Error( 'kodety_fs_not_directory', __( 'The requested path is not a folder.', 'kodety-file-system' ), array( 'status' => 400 ) );
			}
			$visit_limit = min( 50000, max( 100, (int) apply_filters( 'kodety_fs_search_visit_limit', 5000 ) ) );
			$result = $this->scan_tree( $mount, $root, $base, $query, $visit_limit, $deadline );
			if ( is_wp_error( $result ) ) {
				return $result;
			}
			$candidates = $result['items'];
			$truncated  = $result['truncated'];
			$visited    = $result['visited'];
		} else {
			$directory = $this->guard->resolve( $root, $path, true );
			if ( is_wp_error( $directory ) ) {
				return $directory;
			}
			if ( ! is_dir( $directory ) ) {
				return new WP_Error( 'kodety_fs_not_directory', __( 'The requested path is not a folder.', 'kodety-file-system' ), array( 'status' => 400 ) );
			}
			$visit_limit = min( 20000, max( 100, (int) apply_filters( 'kodety_fs_list_visit_limit', 5000 ) ) );
			try {
				$iterator = new FilesystemIterator( $directory, FilesystemIterator::SKIP_DOTS );
				foreach ( $iterator as $entry ) {
					if ( ++$visited > $visit_limit || microtime( true ) >= $deadline ) {
						$truncated = true;
						break;
					}
					if ( $entry->isLink() || $this->should_skip_list_entry( $mount, $entry ) ) {
						continue;
					}
					$relative = '' === $path ? $entry->getFilename() : $path . '/' . $entry->getFilename();
					$candidates[] = array(
						'kind'     => $entry->isDir() ? 'folder' : 'file',
						'name'     => $entry->getFilename(),
						'relative' => $relative,
						'absolute' => $entry->getPathname(),
					);
				}
			} catch ( UnexpectedValueException $exception ) {
				return new WP_Error( 'kodety_fs_scan_failed', $exception->getMessage(), array( 'status' => 500 ) );
			}
		}

		usort( $candidates, static function ( $a, $b ) {
			if ( $a['kind'] !== $b['kind'] ) {
				return 'folder' === $a['kind'] ? -1 : 1;
			}
			return strnatcasecmp( $a['name'], $b['name'] );
		} );
		$total = count( $candidates );
		$page_candidates = array_slice( $candidates, ( $page - 1 ) * $per_page, $per_page );
		$items = array();
		foreach ( $page_candidates as $candidate ) {
			$item = $this->item_from_path( $mount, $candidate['relative'], $candidate['absolute'], false );
			if ( ! is_wp_error( $item ) ) {
				$items[] = $item;
			}
		}
		return array(
			'items'     => $items,
			'total'     => $total,
			'page'      => $page,
			'perPage'   => $per_page,
			'mount'     => $mount,
			'path'      => $path,
			'truncated' => $truncated,
			'visited'   => $visited,
		);
	}

	/** @return array{items:array<int,array<string,string>>,visited:int,truncated:bool}|WP_Error */
	private function scan_tree( string $mount, string $root, string $base, string $query, int $visit_limit, float $deadline ) {
		$items = array();
		$visited = 0;
		$truncated = false;
		$directories = array( $base );
		$directory_index = 0;
		try {
			while ( isset( $directories[ $directory_index ] ) ) {
				if ( microtime( true ) >= $deadline ) {
					$truncated = true;
					break;
				}
				$iterator = new FilesystemIterator( $directories[ $directory_index++ ], FilesystemIterator::SKIP_DOTS );
				foreach ( $iterator as $entry ) {
					if ( ++$visited > $visit_limit || microtime( true ) >= $deadline ) {
						$truncated = true;
						break 2;
					}
					if ( $entry->isLink() || $this->should_skip_list_entry( $mount, $entry ) ) {
						continue;
					}
					$pathname = wp_normalize_path( $entry->getPathname() );
					if ( ! $this->guard->is_within( $root, $pathname ) ) {
						continue;
					}
					if ( $entry->isDir() ) {
						$directories[] = $entry->getPathname();
					}
					$relative = ltrim( substr( $pathname, strlen( untrailingslashit( wp_normalize_path( $root ) ) ) ), '/' );
					$position = function_exists( 'mb_stripos' ) ? mb_stripos( $entry->getFilename(), $query ) : stripos( $entry->getFilename(), $query );
					if ( '' !== $query && false === $position ) {
						continue;
					}
					$items[] = array(
						'kind'     => $entry->isDir() ? 'folder' : 'file',
						'name'     => $entry->getFilename(),
						'relative' => $relative,
						'absolute' => $entry->getPathname(),
					);
				}
			}
		} catch ( UnexpectedValueException $exception ) {
			return new WP_Error( 'kodety_fs_scan_failed', $exception->getMessage(), array( 'status' => 500 ) );
		}
		return array( 'items' => $items, 'visited' => $visited, 'truncated' => $truncated );
	}

	public function stat( array $args ) {
		$location = $this->location( $args, true );
		if ( is_wp_error( $location ) ) {
			return $location;
		}
		return $this->item_from_path( $location['mount'], $location['path'], $location['absolute'] );
	}

	public function read( array $args ) {
		$location = $this->location( $args, true );
		if ( is_wp_error( $location ) ) {
			return $location;
		}
		if ( ! is_file( $location['absolute'] ) ) {
			return new WP_Error( 'kodety_fs_not_file', __( 'The requested path is not a file.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		$max = (int) apply_filters( 'kodety_fs_max_edit_bytes', 5 * MB_IN_BYTES );
		if ( filesize( $location['absolute'] ) > $max ) {
			return new WP_Error( 'kodety_fs_content_too_large', __( 'This file is too large to open in the editor.', 'kodety-file-system' ), array( 'status' => 413, 'maxBytes' => $max ) );
		}
		$content = file_get_contents( $location['absolute'] ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		return false === $content ? new WP_Error( 'kodety_fs_read_failed', __( 'The file could not be read.', 'kodety-file-system' ), array( 'status' => 500 ) ) : $content;
	}

	public function write( array $args ) {
		$lock = $this->acquire_mutation_lock();
		if ( is_wp_error( $lock ) ) { return $lock; }
		$location = $this->location( $args, false );
		if ( is_wp_error( $location ) ) {
			return $location;
		}
		$content = isset( $args['content'] ) && is_string( $args['content'] ) ? $args['content'] : '';
		$max     = (int) apply_filters( 'kodety_fs_max_edit_bytes', 5 * MB_IN_BYTES );
		if ( strlen( $content ) > $max ) {
			return new WP_Error( 'kodety_fs_content_too_large', __( 'The content exceeds the editor limit.', 'kodety-file-system' ), array( 'status' => 413 ) );
		}
		$validated = $this->validate_content_for_location( $location['mount'], $location['path'], $content );
		if ( is_wp_error( $validated ) ) {
			return $validated;
		}
		$content = $validated;
		$replacing = is_file( $location['absolute'] );
		$existing_size = $replacing ? max( 0, (int) @filesize( $location['absolute'] ) ) : 0;
		$capacity = $this->ensure_capacity( strlen( $content ) + $existing_size, $location['absolute'], strlen( $content ) );
		if ( is_wp_error( $capacity ) ) {
			return $capacity;
		}
		$parent  = dirname( $location['absolute'] );
		if ( ! is_dir( $parent ) && ! wp_mkdir_p( $parent ) ) {
			return new WP_Error( 'kodety_fs_mkdir_failed', __( 'The parent folder could not be created.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		if ( $replacing ) {
			$version = $this->create_version( $location['mount'], $location['path'], $location['absolute'] );
			if ( is_wp_error( $version ) ) {
				return $version;
			}
		}
		$result = $this->atomic_write( $location['absolute'], $content );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		$this->apply_mount_permissions( $location['absolute'], $location['mount'] );
		$item = $this->item_from_path( $location['mount'], $location['path'], $location['absolute'] );
		if ( ! is_wp_error( $item ) ) {
			$this->database->upsert_asset( $item );
			$this->database->add_activity( $replacing ? 'write' : 'create', 'local', $location['mount'], $location['path'], null, $item );
		}
		return $item;
	}

	public function create( array $args ) {
		$lock = $this->acquire_mutation_lock();
		if ( is_wp_error( $lock ) ) { return $lock; }
		$mount = sanitize_key( (string) ( $args['mount'] ?? 'project' ) );
		$parent = $this->guard->normalize_relative( (string) ( $args['path'] ?? '' ), true );
		$name   = $this->guard->sanitize_name( (string) ( $args['name'] ?? '' ) );
		if ( is_wp_error( $parent ) ) {
			return $parent;
		}
		if ( is_wp_error( $name ) ) {
			return $name;
		}
		$path = '' === $parent ? $name : $parent . '/' . $name;
		$loc  = $this->location( array( 'mount' => $mount, 'path' => $path ), false );
		if ( is_wp_error( $loc ) ) {
			return $loc;
		}
		$kind = 'folder' === ( $args['kind'] ?? '' ) ? 'folder' : 'file';
		if ( 'file' === $kind ) {
			$sensitive = $this->validate_code_mutation_target( $mount, $path );
			if ( is_wp_error( $sensitive ) ) {
				return $sensitive;
			}
		}
		if ( file_exists( $loc['absolute'] ) ) {
			return new WP_Error( 'kodety_fs_exists', __( 'A file or folder with this name already exists.', 'kodety-file-system' ), array( 'status' => 409 ) );
		}
		if ( 'folder' === $kind ) {
			if ( $this->guard->is_allowed_environment_name( $name ) ) {
				return new WP_Error( 'kodety_fs_invalid_name', __( 'Environment names are reserved for files and cannot be used as folders.', 'kodety-file-system' ), array( 'status' => 400 ) );
			}
			if ( ! wp_mkdir_p( $loc['absolute'] ) ) {
				return new WP_Error( 'kodety_fs_mkdir_failed', __( 'The folder could not be created.', 'kodety-file-system' ), array( 'status' => 500 ) );
			}
			@chmod( $loc['absolute'], 'public' === $mount ? 0755 : 0750 );
		} else {
			return $this->write( array( 'mount' => $mount, 'path' => $path, 'content' => (string) ( $args['content'] ?? '' ) ) );
		}
		$item = $this->item_from_path( $mount, $path, $loc['absolute'] );
		if ( ! is_wp_error( $item ) ) {
			$this->database->upsert_asset( $item );
			$this->database->add_activity( 'create_folder', 'local', $mount, $path, null, $item );
		}
		return $item;
	}

	public function upload( array $file, array $args ) {
		if ( ! isset( $file['tmp_name'], $file['name'] ) || ! is_string( $file['tmp_name'] ) || ! is_readable( $file['tmp_name'] ) ) {
			return new WP_Error( 'kodety_fs_invalid_upload', __( 'The uploaded file is unavailable.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		if ( isset( $file['error'] ) && UPLOAD_ERR_OK !== (int) $file['error'] ) {
			return new WP_Error( 'kodety_fs_upload_error', __( 'The upload did not complete successfully.', 'kodety-file-system' ), array( 'status' => 400, 'uploadError' => (int) $file['error'] ) );
		}
		return $this->import_source(
			$file['tmp_name'],
			sanitize_key( (string) ( $args['mount'] ?? 'project' ) ),
				(string) ( $args['path'] ?? '' ),
				(string) ( $args['name'] ?? $file['name'] ),
				! empty( $args['_validatedReplace'] )
			);
	}

	public function import_path( string $source, string $mount, string $path, ?string $name = null ) {
		if ( ! is_file( $source ) || is_link( $source ) || ! is_readable( $source ) ) {
			return new WP_Error( 'kodety_fs_import_source', __( 'The import source is unavailable.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		$previous_exclusion = $this->capacity_reservation_exclusion;
		$this->capacity_reservation_exclusion = $this->upload_reservation_id_for_source( $source );
		try {
			return $this->import_source( $source, $mount, $path, $name ?: wp_basename( $source ), false );
		} finally {
			$this->capacity_reservation_exclusion = $previous_exclusion;
		}
	}

	/** @return array<string,mixed>|WP_Error */
	private function import_source( string $source, string $mount, string $parent_path, string $source_name, bool $overwrite ) {
		$lock = $this->acquire_mutation_lock();
		if ( is_wp_error( $lock ) ) { return $lock; }
		$source_stat = @lstat( $source );
		if ( ! is_array( $source_stat ) || ! is_file( $source ) || is_link( $source ) || ! is_readable( $source ) || (int) ( $source_stat['nlink'] ?? 1 ) > 1 ) {
			return new WP_Error( 'kodety_fs_import_source', __( 'The import source is unavailable or unsafe.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		$max = (int) apply_filters( 'kodety_fs_max_chunked_upload_bytes', 5 * GB_IN_BYTES );
		$source_size = (int) ( $source_stat['size'] ?? 0 );
		if ( $source_size < 0 || $source_size > $max ) {
			return new WP_Error( 'kodety_fs_upload_too_large', __( 'The upload exceeds the configured limit.', 'kodety-file-system' ), array( 'status' => 413 ) );
		}
		$mount  = sanitize_key( $mount );
		$parent = $this->guard->normalize_relative( $parent_path, true );
		$name   = $this->guard->sanitize_name( $source_name );
		if ( is_wp_error( $parent ) ) {
			return $parent;
		}
		if ( is_wp_error( $name ) ) {
			return $name;
		}
		$path = '' === $parent ? $name : $parent . '/' . $name;
		$loc  = $this->location( array( 'mount' => $mount, 'path' => $path ), false );
		if ( is_wp_error( $loc ) ) {
			return $loc;
		}
		$sensitive = $this->validate_code_mutation_target( $mount, $path );
		if ( is_wp_error( $sensitive ) ) {
			return $sensitive;
		}
		$detected_mime = $this->detect_mime( $source, $name );
		if ( 'public' === $mount ) {
			$public_policy = $this->validate_public_asset( $name, $detected_mime );
			if ( is_wp_error( $public_policy ) ) {
				return $public_policy;
			}
		}
		$replacing = file_exists( $loc['absolute'] );
		if ( $replacing && ! $overwrite ) {
			return new WP_Error( 'kodety_fs_exists', __( 'A file with this name already exists.', 'kodety-file-system' ), array( 'status' => 409 ) );
		}
		$existing_size = $replacing && is_file( $loc['absolute'] ) ? max( 0, (int) @filesize( $loc['absolute'] ) ) : 0;
		$capacity = $this->ensure_capacity( $source_size + $existing_size, $loc['absolute'], $source_size );
		if ( is_wp_error( $capacity ) ) {
			return $capacity;
		}
		$destination_directory = dirname( $loc['absolute'] );
		if ( ! is_dir( $destination_directory ) && ! wp_mkdir_p( $destination_directory ) ) {
			return new WP_Error( 'kodety_fs_mkdir_failed', __( 'The destination folder could not be created.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}

		if ( 'svg' === strtolower( pathinfo( $path, PATHINFO_EXTENSION ) ) ) {
			if ( $source_size > 10 * MB_IN_BYTES ) {
				return new WP_Error( 'kodety_fs_svg_too_large', __( 'The SVG is too large.', 'kodety-file-system' ), array( 'status' => 413 ) );
			}
			$content = file_get_contents( $source ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
			if ( false === $content ) {
				return new WP_Error( 'kodety_fs_read_upload_failed', __( 'The uploaded file could not be read.', 'kodety-file-system' ), array( 'status' => 500 ) );
			}
			$validated = $this->validate_content_for_location( $mount, $path, $content );
			if ( is_wp_error( $validated ) ) {
				return $validated;
			}
			if ( $replacing ) {
				$version = $this->create_version( $mount, $path, $loc['absolute'] );
				if ( is_wp_error( $version ) ) {
					return $version;
				}
			}
			$result = $this->atomic_write( $loc['absolute'], $validated );
		} else {
			$temp = $destination_directory . '/.kodety-' . wp_generate_uuid4() . '.upload.part';
			$input = @fopen( $source, 'rb' );
			$output = @fopen( $temp, 'xb' );
			if ( false === $input || false === $output ) {
				if ( is_resource( $input ) ) { fclose( $input ); }
				if ( is_resource( $output ) ) { fclose( $output ); }
				@unlink( $temp );
				return new WP_Error( 'kodety_fs_temp_failed', __( 'A temporary upload file could not be created.', 'kodety-file-system' ), array( 'status' => 500 ) );
			}
			$locked = flock( $output, LOCK_EX );
			$copied = $locked ? stream_copy_to_stream( $input, $output ) : false;
			$result = false !== $copied && (int) $copied === $source_size && fflush( $output );
			if ( $result && function_exists( 'fsync' ) ) {
				$result = fsync( $output );
			}
			if ( $locked ) { flock( $output, LOCK_UN ); }
			fclose( $input );
			fclose( $output );
			if ( ! $result ) {
				@unlink( $temp );
				return new WP_Error( 'kodety_fs_upload_write', __( 'The uploaded file could not be staged.', 'kodety-file-system' ), array( 'status' => 500 ) );
			}
			if ( $replacing ) {
				$version = $this->create_version( $mount, $path, $loc['absolute'] );
				if ( is_wp_error( $version ) ) {
					@unlink( $temp );
					return $version;
				}
			}
			$result = @rename( $temp, $loc['absolute'] ); // phpcs:ignore WordPress.WP.AlternativeFunctions.rename_rename
			if ( ! $result ) {
				@unlink( $temp );
			}
		}
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		if ( ! $result ) {
			return new WP_Error( 'kodety_fs_upload_write', __( 'The uploaded file could not be committed.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		$this->apply_mount_permissions( $loc['absolute'], $mount );
		$item = $this->item_from_path( $mount, $path, $loc['absolute'] );
		if ( ! is_wp_error( $item ) ) {
			$this->database->upsert_asset( $item );
			$this->database->add_activity( $replacing ? 'replace' : 'upload', 'local', $mount, $path, null, $item );
		}
		return $item;
	}

	public function delete( array $args ) {
		$lock = $this->acquire_mutation_lock();
		if ( is_wp_error( $lock ) ) { return $lock; }
		$storage = $this->require_private_storage();
		if ( is_wp_error( $storage ) ) {
			return $storage;
		}
		$location = $this->location( $args, true );
		if ( is_wp_error( $location ) ) {
			return $location;
		}
		if ( '' === $location['path'] ) {
			return new WP_Error( 'kodety_fs_delete_mount', __( 'A mount root cannot be deleted.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		$uuid      = wp_generate_uuid4();
		$trash_rel = $uuid . '/payload';
		$trash_abs = $this->system_root . '/trash/' . $trash_rel;
		if ( ! $this->same_filesystem( $location['absolute'], dirname( $trash_abs ) ) ) {
			$measurement = $this->measure_paths( array( $location['absolute'] ) );
			if ( is_wp_error( $measurement ) ) {
				return $measurement;
			}
			$capacity = $this->ensure_capacity( $measurement['bytes'], $trash_abs, 0 );
			if ( is_wp_error( $capacity ) ) {
				return $capacity;
			}
		}
		if ( ! wp_mkdir_p( dirname( $trash_abs ) ) ) {
			return new WP_Error( 'kodety_fs_trash_failed', __( 'The item could not be moved to trash.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		$moved = $this->move_tree( $location['absolute'], $trash_abs );
		if ( is_wp_error( $moved ) ) {
			return $moved;
		}
		$indexed = $this->database->add_trash( array( 'id' => $uuid, 'provider' => 'local', 'mount' => $location['mount'], 'path' => $location['path'], 'trash_relpath' => $trash_rel, 'is_dir' => is_dir( $trash_abs ) ) );
		if ( ! $indexed ) {
			wp_mkdir_p( dirname( $location['absolute'] ) );
			$rollback = $this->move_tree( $trash_abs, $location['absolute'] );
			@rmdir( dirname( $trash_abs ) );
			return is_wp_error( $rollback )
				? new WP_Error( 'kodety_fs_trash_index_rollback', __( 'Trash indexing failed and the filesystem rollback also failed. An administrator must recover the item from the trash storage.', 'kodety-file-system' ), array( 'status' => 500, 'recoveryId' => $uuid ) )
				: new WP_Error( 'kodety_fs_trash_index', __( 'The item was restored because the trash index could not be written.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		$this->database->add_activity( 'trash', 'local', $location['mount'], $location['path'], null, array( 'trashId' => $uuid ) );
		return array( 'id' => $uuid, 'trashed' => true, 'mount' => $location['mount'], 'path' => $location['path'] );
	}

	public function trash_items( int $limit = 100 ): array {
		return $this->database->trash_items( $limit );
	}

	public function restore_trash( string $uuid ) {
		$lock = $this->acquire_mutation_lock();
		if ( is_wp_error( $lock ) ) { return $lock; }
		$storage = $this->require_private_storage();
		if ( is_wp_error( $storage ) ) {
			return $storage;
		}
		$row = $this->database->trash_item( $uuid );
		if ( ! $row || 'local' !== $row['provider'] ) {
			return new WP_Error( 'kodety_fs_trash_not_found', __( 'The trash item was not found.', 'kodety-file-system' ), array( 'status' => 404 ) );
		}
		$source = $this->guard->resolve( $this->system_root . '/trash', $row['trash_relpath'], true );
		if ( is_wp_error( $source ) ) {
			return $source;
		}
		$dest = $this->location( array( 'mount' => $row['original_mount'], 'path' => $row['original_path'] ), false );
		if ( is_wp_error( $dest ) ) {
			return $dest;
		}
		if ( file_exists( $dest['absolute'] ) ) {
			return new WP_Error( 'kodety_fs_restore_conflict', __( 'Another item now exists at the original path.', 'kodety-file-system' ), array( 'status' => 409 ) );
		}
		$policy = $this->validate_destination_tree( $source, $dest['mount'], $dest['path'] );
		if ( is_wp_error( $policy ) ) {
			return $policy;
		}
		if ( ! $this->same_filesystem( $source, dirname( $dest['absolute'] ) ) ) {
			$measurement = $this->measure_paths( array( $source ) );
			if ( is_wp_error( $measurement ) ) {
				return $measurement;
			}
			$capacity = $this->ensure_capacity( $measurement['bytes'], $dest['absolute'], 0 );
			if ( is_wp_error( $capacity ) ) {
				return $capacity;
			}
		}
		if ( ! is_dir( dirname( $dest['absolute'] ) ) ) {
			wp_mkdir_p( dirname( $dest['absolute'] ) );
		}
		$moved = $this->move_tree( $source, $dest['absolute'] );
		if ( is_wp_error( $moved ) ) {
			return new WP_Error( 'kodety_fs_restore_failed', $moved->get_error_message(), array( 'status' => 500 ) );
		}
		if ( ! $this->database->remove_trash( $uuid ) ) {
			$rollback = $this->move_tree( $dest['absolute'], $source );
			return is_wp_error( $rollback )
				? new WP_Error( 'kodety_fs_restore_index_rollback', __( 'The item was restored, but its trash index could not be updated. An administrator must reconcile storage.', 'kodety-file-system' ), array( 'status' => 500 ) )
				: new WP_Error( 'kodety_fs_restore_index', __( 'Restore was rolled back because the trash index could not be updated.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		@rmdir( dirname( $source ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir
		$item = $this->item_from_path( $dest['mount'], $dest['path'], $dest['absolute'] );
		$this->database->add_activity( 'restore', 'local', $dest['mount'], $dest['path'], array( 'trashId' => $uuid ), $item );
		return $item;
	}

	public function delete_trash_permanently( string $uuid ) {
		$lock = $this->acquire_mutation_lock();
		if ( is_wp_error( $lock ) ) { return $lock; }
		$storage = $this->require_private_storage();
		if ( is_wp_error( $storage ) ) {
			return $storage;
		}
		$row = $this->database->trash_item( $uuid );
		if ( ! $row || 'local' !== $row['provider'] ) {
			return new WP_Error( 'kodety_fs_trash_not_found', __( 'The trash item was not found.', 'kodety-file-system' ), array( 'status' => 404 ) );
		}
		$source = $this->guard->resolve( $this->system_root . '/trash', $row['trash_relpath'], true );
		if ( is_wp_error( $source ) ) {
			return $source;
		}
		if ( ! $this->database->remove_trash( $uuid ) ) {
			return new WP_Error( 'kodety_fs_trash_index', __( 'The trash index could not be updated, so no bytes were deleted.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		$result = $this->remove_tree( $source );
		if ( is_wp_error( $result ) ) {
			$reindexed = $this->database->add_trash( array( 'id' => $uuid, 'provider' => 'local', 'mount' => $row['original_mount'], 'path' => $row['original_path'], 'trash_relpath' => $row['trash_relpath'], 'is_dir' => (bool) $row['is_dir'] ) );
			return $reindexed ? $result : new WP_Error( 'kodety_fs_trash_delete_rollback', __( 'Permanent deletion failed and the trash index could not be restored.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		@rmdir( dirname( $source ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir
		$this->database->add_activity( 'delete_permanently', 'local', $row['original_mount'], $row['original_path'] );
		return array( 'id' => $uuid, 'deleted' => true );
	}

	public function move( array $args ) {
		$lock = $this->acquire_mutation_lock();
		if ( is_wp_error( $lock ) ) { return $lock; }
		$source = $this->location( array( 'mount' => $args['mount'] ?? 'project', 'path' => $args['path'] ?? '' ), true );
		if ( is_wp_error( $source ) ) {
			return $source;
		}
		$to_mount = sanitize_key( (string) ( $args['toMount'] ?? $source['mount'] ) );
		$to_path  = $this->guard->normalize_relative( (string) ( $args['toPath'] ?? '' ), false );
		if ( is_wp_error( $to_path ) ) {
			return $to_path;
		}
		$dest = $this->location( array( 'mount' => $to_mount, 'path' => $to_path ), false );
		if ( is_wp_error( $dest ) ) {
			return $dest;
		}
		$validated = $this->validate_destination_tree( $source['absolute'], $to_mount, $to_path );
		if ( is_wp_error( $validated ) ) {
			return $validated;
		}
		if ( file_exists( $dest['absolute'] ) ) {
			return new WP_Error( 'kodety_fs_exists', __( 'The destination already exists.', 'kodety-file-system' ), array( 'status' => 409 ) );
		}
		if ( is_dir( $source['absolute'] ) && $this->guard->is_within( $source['absolute'], dirname( $dest['absolute'] ) ) ) {
			return new WP_Error( 'kodety_fs_recursive_move', __( 'A folder cannot be moved into itself.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		if ( ! $this->same_filesystem( $source['absolute'], dirname( $dest['absolute'] ) ) ) {
			$measurement = $this->measure_paths( array( $source['absolute'] ) );
			if ( is_wp_error( $measurement ) ) {
				return $measurement;
			}
			$capacity = $this->ensure_capacity( $measurement['bytes'], $dest['absolute'], 0 );
			if ( is_wp_error( $capacity ) ) {
				return $capacity;
			}
		}
		wp_mkdir_p( dirname( $dest['absolute'] ) );
		if ( ! @rename( $source['absolute'], $dest['absolute'] ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.rename_rename
			$copy = $this->copy_tree( $source['absolute'], $dest['absolute'] );
			if ( is_wp_error( $copy ) ) {
				return $copy;
			}
			$removed = $this->remove_tree( $source['absolute'] );
			if ( is_wp_error( $removed ) ) {
				return $removed;
			}
		}
		$this->apply_mount_permissions( $dest['absolute'], $to_mount );
		$item = $this->item_from_path( $dest['mount'], $dest['path'], $dest['absolute'] );
		if ( ! is_wp_error( $item ) ) {
			$this->database->upsert_asset( $item );
		}
		$this->database->add_activity( 'move', 'local', $dest['mount'], $dest['path'], array( 'mount' => $source['mount'], 'path' => $source['path'] ), $item );
		return $item;
	}

	public function copy( array $args ) {
		$lock = $this->acquire_mutation_lock();
		if ( is_wp_error( $lock ) ) { return $lock; }
		$source = $this->location( array( 'mount' => $args['mount'] ?? 'project', 'path' => $args['path'] ?? '' ), true );
		if ( is_wp_error( $source ) ) {
			return $source;
		}
		$to_mount = sanitize_key( (string) ( $args['toMount'] ?? $source['mount'] ) );
		$to_path  = $this->guard->normalize_relative( (string) ( $args['toPath'] ?? '' ), false );
		if ( is_wp_error( $to_path ) ) {
			return $to_path;
		}
		$dest = $this->location( array( 'mount' => $to_mount, 'path' => $to_path ), false );
		if ( is_wp_error( $dest ) ) {
			return $dest;
		}
		$validated = $this->validate_destination_tree( $source['absolute'], $to_mount, $to_path );
		if ( is_wp_error( $validated ) ) {
			return $validated;
		}
		if ( file_exists( $dest['absolute'] ) ) {
			return new WP_Error( 'kodety_fs_exists', __( 'The destination already exists.', 'kodety-file-system' ), array( 'status' => 409 ) );
		}
		$measurement = $this->measure_paths( array( $source['absolute'] ) );
		if ( is_wp_error( $measurement ) ) {
			return $measurement;
		}
		$capacity = $this->ensure_capacity( $measurement['bytes'], $dest['absolute'], $measurement['bytes'] );
		if ( is_wp_error( $capacity ) ) {
			return $capacity;
		}
		$result = $this->copy_tree( $source['absolute'], $dest['absolute'] );
		if ( is_wp_error( $result ) ) {
			if ( file_exists( $dest['absolute'] ) && ! is_link( $dest['absolute'] ) ) { $this->remove_tree( $dest['absolute'] ); }
			return $result;
		}
		$this->apply_mount_permissions( $dest['absolute'], $to_mount );
		$item = $this->item_from_path( $dest['mount'], $dest['path'], $dest['absolute'] );
		if ( ! is_wp_error( $item ) ) {
			$this->database->upsert_asset( $item );
		}
		$this->database->add_activity( 'copy', 'local', $dest['mount'], $dest['path'], array( 'mount' => $source['mount'], 'path' => $source['path'] ), $item );
		return $item;
	}

	public function duplicate( array $args ) {
		$lock = $this->acquire_mutation_lock();
		if ( is_wp_error( $lock ) ) { return $lock; }
		$source = $this->location( $args, true );
		if ( is_wp_error( $source ) ) {
			return $source;
		}
		$directory = dirname( $source['path'] );
		$directory = '.' === $directory ? '' : $directory;
		$name = wp_basename( $source['path'] );
		$extension = pathinfo( $name, PATHINFO_EXTENSION );
		$stem = '' === $extension ? $name : substr( $name, 0, - strlen( $extension ) - 1 );
		for ( $i = 1; $i < 1000; $i++ ) {
			$suffix = 1 === $i ? ' copy' : ' copy ' . $i;
			$new_name = $stem . $suffix . ( '' === $extension ? '' : '.' . $extension );
			$new_path = ( '' === $directory ? '' : $directory . '/' ) . $new_name;
			$test = $this->location( array( 'mount' => $source['mount'], 'path' => $new_path ), false );
			if ( ! is_wp_error( $test ) && ! file_exists( $test['absolute'] ) ) {
				return $this->copy( array( 'mount' => $source['mount'], 'path' => $source['path'], 'toMount' => $source['mount'], 'toPath' => $new_path ) );
			}
		}
		return new WP_Error( 'kodety_fs_duplicate_failed', __( 'A duplicate name could not be allocated.', 'kodety-file-system' ), array( 'status' => 409 ) );
	}

	public function set_visibility( array $args ) {
		$storage = $this->require_private_storage();
		if ( is_wp_error( $storage ) ) {
			return $storage;
		}
		$visibility = 'public' === ( $args['visibility'] ?? '' ) ? 'public' : 'private';
		$source     = $this->location( $args, true );
		if ( is_wp_error( $source ) ) {
			return $source;
		}
		$to_mount = $visibility;
		$to_path  = isset( $args['toPath'] ) ? (string) $args['toPath'] : $source['path'];
		if ( $source['mount'] === $to_mount && $source['path'] === $to_path ) {
			return $this->stat( $source );
		}
		return $this->move( array( 'mount' => $source['mount'], 'path' => $source['path'], 'toMount' => $to_mount, 'toPath' => $to_path ) );
	}

	public function get_url( array $args ) {
		$item = $this->stat( $args );
		if ( is_wp_error( $item ) ) {
			return $item;
		}
		return array( 'url' => $item['publicUrl'], 'previewUrl' => $item['previewUrl'] );
	}

	public function versions( string $mount, string $path ): array {
		return $this->database->versions( $this->database->asset_key( 'local', $mount, $path ) );
	}

	public function restore_version( string $version_id ) {
		$lock = $this->acquire_mutation_lock();
		if ( is_wp_error( $lock ) ) { return $lock; }
		$storage = $this->require_private_storage();
		if ( is_wp_error( $storage ) ) {
			return $storage;
		}
		$row = $this->database->version( $version_id );
		if ( ! $row || 'local' !== $row['provider'] ) {
			return new WP_Error( 'kodety_fs_version_not_found', __( 'The requested version was not found.', 'kodety-file-system' ), array( 'status' => 404 ) );
		}
		$source = $this->guard->resolve( $this->system_root . '/versions', $row['storage_path'], true );
		if ( is_wp_error( $source ) ) {
			return $source;
		}
		$source_checksum = (string) @hash_file( 'sha256', $source );
		if ( '' === $source_checksum || ! hash_equals( strtolower( (string) $row['checksum'] ), strtolower( $source_checksum ) ) ) {
			return new WP_Error( 'kodety_fs_version_corrupt', __( 'The stored version failed its integrity check.', 'kodety-file-system' ), array( 'status' => 409 ) );
		}
		$dest = $this->location( array( 'mount' => $row['mount_id'], 'path' => $row['path'] ), false );
		if ( is_wp_error( $dest ) ) {
			return $dest;
		}
		$policy = $this->validate_destination_tree( $source, $dest['mount'], $dest['path'] );
		if ( is_wp_error( $policy ) ) {
			return $policy;
		}
		$source_size = max( 0, (int) @filesize( $source ) );
		$existing_size = is_file( $dest['absolute'] ) ? max( 0, (int) @filesize( $dest['absolute'] ) ) : 0;
		$capacity = $this->ensure_capacity( $source_size + $existing_size, $dest['absolute'], $source_size );
		if ( is_wp_error( $capacity ) ) {
			return $capacity;
		}
		if ( file_exists( $dest['absolute'] ) ) {
			$backup = $this->create_version( $dest['mount'], $dest['path'], $dest['absolute'] );
			if ( is_wp_error( $backup ) ) {
				return $backup;
			}
		}
		$result = $this->atomic_copy( $source, $dest['absolute'] );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		$this->apply_mount_permissions( $dest['absolute'], $dest['mount'] );
		$item = $this->item_from_path( $dest['mount'], $dest['path'], $dest['absolute'] );
		$this->database->add_activity( 'restore_version', 'local', $dest['mount'], $dest['path'], array( 'versionId' => $version_id ), $item );
		return $item;
	}

	public function compress( array $sources, string $target_mount, string $target_path ) {
		$lock = $this->acquire_mutation_lock();
		if ( is_wp_error( $lock ) ) { return $lock; }
		if ( ! class_exists( 'ZipArchive' ) ) {
			return new WP_Error( 'kodety_fs_zip_unavailable', __( 'ZipArchive is not available on this server.', 'kodety-file-system' ), array( 'status' => 501 ) );
		}
		$dest = $this->location( array( 'mount' => $target_mount, 'path' => $target_path ), false );
		if ( is_wp_error( $dest ) ) {
			return $dest;
		}
		if ( 'zip' !== strtolower( pathinfo( $dest['path'], PATHINFO_EXTENSION ) ) ) {
			return new WP_Error( 'kodety_fs_zip_extension', __( 'The archive destination must use a .zip extension.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		if ( file_exists( $dest['absolute'] ) && ! is_file( $dest['absolute'] ) ) {
			return new WP_Error( 'kodety_fs_zip_conflict', __( 'The archive destination conflicts with an existing folder.', 'kodety-file-system' ), array( 'status' => 409 ) );
		}
		if ( 'public' === $dest['mount'] ) {
			$policy = $this->validate_public_asset( $dest['path'], 'application/zip' );
			if ( is_wp_error( $policy ) ) {
				return $policy;
			}
		}
		$resolved_sources = array();
		foreach ( array_slice( $sources, 0, 500 ) as $source_args ) {
			$source = $this->location( is_array( $source_args ) ? $source_args : array(), true );
			if ( is_wp_error( $source ) ) {
				return $source;
			}
			$resolved_sources[] = $source;
		}
		if ( empty( $resolved_sources ) ) {
			return new WP_Error( 'kodety_fs_zip_empty', __( 'Select at least one file or folder to compress.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		$measurement = $this->measure_paths( array_column( $resolved_sources, 'absolute' ), 5000, 5.0 );
		if ( is_wp_error( $measurement ) ) {
			return $measurement;
		}
		$archive_overhead = max( MB_IN_BYTES, (int) min( PHP_INT_MAX, ceil( $measurement['bytes'] * 0.02 ) + $measurement['entries'] * 256 ) );
		if ( $measurement['bytes'] > PHP_INT_MAX - $archive_overhead ) {
			return new WP_Error( 'kodety_fs_zip_size', __( 'The archive estimate is too large to represent safely.', 'kodety-file-system' ), array( 'status' => 413 ) );
		}
		$archive_estimate = $measurement['bytes'] + $archive_overhead;
		$existing_size = is_file( $dest['absolute'] ) ? max( 0, (int) @filesize( $dest['absolute'] ) ) : 0;
		if ( $existing_size > PHP_INT_MAX - $archive_estimate ) {
			return new WP_Error( 'kodety_fs_zip_size', __( 'The archive estimate is too large to represent safely.', 'kodety-file-system' ), array( 'status' => 413 ) );
		}
		$capacity = $this->ensure_capacity( $archive_estimate + $existing_size, $dest['absolute'], $archive_estimate );
		if ( is_wp_error( $capacity ) ) {
			return $capacity;
		}
		wp_mkdir_p( dirname( $dest['absolute'] ) );
		$temp = dirname( $dest['absolute'] ) . '/.kodety-' . wp_generate_uuid4() . '.zip.part';
		$zip  = new ZipArchive();
		if ( true !== $zip->open( $temp, ZipArchive::CREATE | ZipArchive::OVERWRITE ) ) {
			return new WP_Error( 'kodety_fs_zip_open', __( 'The archive could not be created.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		$count = 0;
		$archive_deadline = microtime( true ) + min( 30.0, max( 1.0, (float) apply_filters( 'kodety_fs_archive_deadline_seconds', 10.0 ) ) );
		foreach ( $resolved_sources as $source ) {
			if ( microtime( true ) >= $archive_deadline ) {
				$zip->close();
				@unlink( $temp );
				return new WP_Error( 'kodety_fs_zip_limit', __( 'The archive exceeded its processing-time limit.', 'kodety-file-system' ), array( 'status' => 413 ) );
			}
			$base_name = '' === $source['path'] ? $source['mount'] : wp_basename( $source['path'] );
			if ( is_file( $source['absolute'] ) ) {
				if ( ! $zip->addFile( $source['absolute'], $base_name ) ) {
					$zip->close();
					@unlink( $temp );
					return new WP_Error( 'kodety_fs_zip_add', __( 'A source file could not be added to the archive.', 'kodety-file-system' ), array( 'status' => 500 ) );
				}
				++$count;
				continue;
			}
			$iterator = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $source['absolute'], FilesystemIterator::SKIP_DOTS ), RecursiveIteratorIterator::SELF_FIRST );
			foreach ( $iterator as $entry ) {
				$entry_path = wp_normalize_path( $entry->getPathname() );
				if ( $entry_path === wp_normalize_path( $temp ) || $entry_path === wp_normalize_path( $dest['absolute'] ) ) {
					continue;
				}
				if ( $entry->isLink() || ++$count > 5000 || microtime( true ) >= $archive_deadline ) {
					$zip->close();
					@unlink( $temp );
					return new WP_Error( 'kodety_fs_zip_limit', __( 'The archive exceeds its item or processing-time limit.', 'kodety-file-system' ), array( 'status' => 413 ) );
				}
				$relative = ltrim( substr( $entry_path, strlen( wp_normalize_path( $source['absolute'] ) ) ), '/' );
				$zip_name = $base_name . '/' . $relative;
				$added = $entry->isDir() ? $zip->addEmptyDir( $zip_name ) : $zip->addFile( $entry->getPathname(), $zip_name );
				if ( ! $added ) {
					$zip->close();
					@unlink( $temp );
					return new WP_Error( 'kodety_fs_zip_add', __( 'An archive entry could not be added.', 'kodety-file-system' ), array( 'status' => 500 ) );
				}
			}
		}
		if ( ! $zip->close() || ! is_file( $temp ) || (int) @filesize( $temp ) <= 0 ) {
			@unlink( $temp );
			return new WP_Error( 'kodety_fs_zip_finalize', __( 'The archive could not be finalized safely.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		$verification = new ZipArchive();
		$verification_open = $verification->open( $temp, ZipArchive::CHECKCONS );
		if ( true !== $verification_open || $verification->numFiles !== $count ) {
			if ( true === $verification_open ) { $verification->close(); }
			@unlink( $temp );
			return new WP_Error( 'kodety_fs_zip_verify', __( 'The completed archive failed its integrity check.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		$verification->close();
		if ( file_exists( $dest['absolute'] ) ) {
			$version = $this->create_version( $dest['mount'], $dest['path'], $dest['absolute'] );
			if ( is_wp_error( $version ) ) {
				@unlink( $temp );
				return $version;
			}
		}
		if ( ! @rename( $temp, $dest['absolute'] ) ) {
			@unlink( $temp );
			return new WP_Error( 'kodety_fs_zip_move', __( 'The archive could not be saved.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		$this->apply_mount_permissions( $dest['absolute'], $dest['mount'] );
		$item = $this->item_from_path( $dest['mount'], $dest['path'], $dest['absolute'] );
		$this->database->add_activity( 'compress', 'local', $dest['mount'], $dest['path'], null, array( 'count' => $count ) );
		return $item;
	}

	public function extract( string $mount, string $path, string $destination_path ) {
		$lock = $this->acquire_mutation_lock();
		if ( is_wp_error( $lock ) ) { return $lock; }
		if ( ! class_exists( 'ZipArchive' ) ) {
			return new WP_Error( 'kodety_fs_zip_unavailable', __( 'ZipArchive is not available on this server.', 'kodety-file-system' ), array( 'status' => 501 ) );
		}
		$source = $this->location( array( 'mount' => $mount, 'path' => $path ), true );
		$dest   = $this->location( array( 'mount' => $mount, 'path' => $destination_path ), false );
		if ( is_wp_error( $source ) ) {
			return $source;
		}
		if ( is_wp_error( $dest ) ) {
			return $dest;
		}
		$zip = new ZipArchive();
		if ( true !== $zip->open( $source['absolute'] ) ) {
			return new WP_Error( 'kodety_fs_zip_invalid', __( 'The ZIP archive is invalid.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		$entry_count = $zip->numFiles;
		if ( $entry_count > 5000 ) {
			$zip->close();
			return new WP_Error( 'kodety_fs_zip_limit', __( 'The archive contains too many entries.', 'kodety-file-system' ), array( 'status' => 413 ) );
		}

		$total   = 0;
		$entries = array();
		for ( $i = 0; $i < $entry_count; $i++ ) {
			$stat = $zip->statIndex( $i );
			$name = isset( $stat['name'] ) ? str_replace( '\\', '/', (string) $stat['name'] ) : '';
			$is_dir = str_ends_with( $name, '/' );
			$name = rtrim( $name, '/' );
			$relative = $this->guard->normalize_relative( $name, $is_dir );
			if ( is_wp_error( $relative ) || '' === $relative && ! $is_dir ) {
				$zip->close();
				return new WP_Error( 'kodety_fs_zip_path', __( 'The ZIP contains an unsafe path.', 'kodety-file-system' ), array( 'status' => 400 ) );
			}
			if ( $is_dir && $this->guard->is_allowed_environment_name( wp_basename( $relative ) ) ) {
				$zip->close();
				return new WP_Error( 'kodety_fs_zip_path', __( 'Environment names are reserved for files and cannot be extracted as folders.', 'kodety-file-system' ), array( 'status' => 400 ) );
			}
			if ( ! $is_dir && 'public' === $mount && is_wp_error( $this->validate_public_asset( $relative ) ) ) {
				$zip->close();
				return new WP_Error( 'kodety_fs_zip_public_content', __( 'The ZIP contains a file type that cannot be served safely by this public mount.', 'kodety-file-system' ), array( 'status' => 400 ) );
			}
			$size = (int) ( $stat['size'] ?? 0 );
			$compressed_size = (int) ( $stat['comp_size'] ?? 0 );
			$total += $size;
			if ( $total > 512 * MB_IN_BYTES || $size > 128 * MB_IN_BYTES || $size > MB_IN_BYTES && ( 0 === $compressed_size || $size / max( 1, $compressed_size ) > 250 ) ) {
				$zip->close();
				return new WP_Error( 'kodety_fs_zip_size', __( 'The extracted archive exceeds the configured size or compression-ratio limit.', 'kodety-file-system' ), array( 'status' => 413 ) );
			}
			$attributes = (int) ( $stat['external_attributes'] ?? 0 );
			if ( method_exists( $zip, 'getExternalAttributesIndex' ) ) {
				$operations_system = 0;
				$external_attributes = 0;
				if ( $zip->getExternalAttributesIndex( $i, $operations_system, $external_attributes ) ) {
					$attributes = (int) $external_attributes;
				}
			}
			if ( 0120000 === ( ( $attributes >> 16 ) & 0170000 ) ) {
				$zip->close();
				return new WP_Error( 'kodety_fs_zip_symlink', __( 'Symbolic links are not allowed in ZIP archives.', 'kodety-file-system' ), array( 'status' => 400 ) );
			}
			$target_rel = '' === $destination_path ? $relative : trailingslashit( $destination_path ) . $relative;
			$sensitive = $this->validate_code_mutation_target( $mount, $target_rel );
			if ( is_wp_error( $sensitive ) ) {
				$zip->close();
				return $sensitive;
			}
			$target = $this->location( array( 'mount' => $mount, 'path' => $target_rel ), false );
			if ( is_wp_error( $target ) ) {
				$zip->close();
				return $target;
			}
			if ( file_exists( $target['absolute'] ) && ( ! $is_dir || ! is_dir( $target['absolute'] ) ) ) {
				$zip->close();
				return new WP_Error( 'kodety_fs_zip_conflict', __( 'The ZIP would overwrite an existing item.', 'kodety-file-system' ), array( 'status' => 409 ) );
			}
			$entries[] = array( 'archiveName' => (string) $stat['name'], 'relative' => $relative, 'isDir' => $is_dir, 'size' => $size );
		}
		$capacity = $this->ensure_capacity( $total, $dest['absolute'], $total );
		if ( is_wp_error( $capacity ) ) {
			$zip->close();
			return $capacity;
		}

		$destination_exists = is_dir( $dest['absolute'] );
		$staging_parent = $destination_exists ? $dest['absolute'] : dirname( $dest['absolute'] );
		$staging = $staging_parent . '/.kodety-extract-' . wp_generate_uuid4();
		if ( ! wp_mkdir_p( $staging ) ) {
			$zip->close();
			return new WP_Error( 'kodety_fs_zip_staging', __( 'A staging folder could not be created.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}

		foreach ( $entries as $entry ) {
			$staged_target = $staging . '/' . $entry['relative'];
			if ( $entry['isDir'] ) {
				if ( ! wp_mkdir_p( $staged_target ) ) {
					$zip->close();
					$this->remove_tree( $staging );
					return new WP_Error( 'kodety_fs_zip_staging', __( 'An archive folder could not be staged.', 'kodety-file-system' ), array( 'status' => 500 ) );
				}
				continue;
			}
			$stream = $zip->getStream( $entry['archiveName'] );
			if ( false === $stream ) {
				$zip->close();
				$this->remove_tree( $staging );
				return new WP_Error( 'kodety_fs_zip_stream', __( 'An archive entry could not be read.', 'kodety-file-system' ), array( 'status' => 500 ) );
			}
			wp_mkdir_p( dirname( $staged_target ) );
			$output = @fopen( $staged_target, 'xb' );
			$locked = false !== $output && flock( $output, LOCK_EX );
			$copied = $locked ? stream_copy_to_stream( $stream, $output, (int) $entry['size'] + 1 ) : false;
			$flushed = false !== $output && false !== $copied && (int) $copied === (int) $entry['size'] && fflush( $output );
			if ( $flushed && function_exists( 'fsync' ) ) { $flushed = fsync( $output ); }
			if ( $locked ) { flock( $output, LOCK_UN ); }
			if ( is_resource( $output ) ) { fclose( $output ); }
			fclose( $stream );
			if ( ! $flushed ) {
				@unlink( $staged_target );
				$zip->close();
				$this->remove_tree( $staging );
				return new WP_Error( 'kodety_fs_zip_stream', __( 'An archive entry could not be read.', 'kodety-file-system' ), array( 'status' => 500 ) );
			}
			$target_rel = '' === $destination_path ? $entry['relative'] : trailingslashit( $destination_path ) . $entry['relative'];
			if ( 'public' === $mount ) {
				$policy = $this->validate_public_asset( $target_rel, $this->detect_mime( $staged_target, $target_rel ) );
				if ( is_wp_error( $policy ) ) {
					$zip->close();
					$this->remove_tree( $staging );
					return $policy;
				}
			}
			if ( 'svg' === strtolower( pathinfo( $target_rel, PATHINFO_EXTENSION ) ) ) {
				$content = (int) $entry['size'] <= 10 * MB_IN_BYTES ? @file_get_contents( $staged_target ) : false; // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
				$validated = false === $content ? new WP_Error( 'kodety_fs_svg_too_large', __( 'The SVG is too large or unreadable.', 'kodety-file-system' ), array( 'status' => 413 ) ) : $this->guard->sanitize_svg( $content );
				if ( ! is_wp_error( $validated ) && $validated !== $content ) {
					@unlink( $staged_target );
					$validated = $this->atomic_write( $staged_target, $validated );
				}
			} else {
				$validated = true;
			}
			if ( is_wp_error( $validated ) ) {
				$zip->close();
				$this->remove_tree( $staging );
				return $validated;
			}
			@chmod( $staged_target, 0640 );
		}
		$zip->close();

		if ( $destination_exists ) {
			$committed = $this->merge_staged_tree( $staging, $dest['absolute'] );
		} else {
			$committed = $this->move_tree( $staging, $dest['absolute'] );
		}
		if ( is_wp_error( $committed ) ) {
			$this->remove_tree( $staging );
			return $committed;
		}
		$this->apply_mount_permissions( $dest['absolute'], $mount );
		$this->database->add_activity( 'extract', 'local', $mount, $destination_path, array( 'archive' => $path ), array( 'entries' => $entry_count ) );
		return $this->list( array( 'mount' => $mount, 'path' => $destination_path ) );
	}

	public function rescan( string $mount, string $path = '' ) {
		$root = $this->mount_root( $mount );
		if ( is_wp_error( $root ) ) {
			return $root;
		}
		$base = $this->guard->resolve( $root, $path, true );
		if ( is_wp_error( $base ) ) {
			return $base;
		}
		$seen = array();
		$count = 0;
		$paths = array( $base );
		if ( is_dir( $base ) ) {
			$iterator = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $base, FilesystemIterator::SKIP_DOTS ), RecursiveIteratorIterator::SELF_FIRST );
			foreach ( $iterator as $entry ) {
				if ( ! $entry->isLink() && ! $this->should_skip_list_entry( $mount, $entry ) ) {
					$paths[] = $entry->getPathname();
				}
			}
		}
		foreach ( $paths as $absolute ) {
			if ( ++$count > 20000 ) {
				break;
			}
			$relative = ltrim( substr( wp_normalize_path( $absolute ), strlen( untrailingslashit( wp_normalize_path( $root ) ) ) ), '/' );
			$item = $this->item_from_path( $mount, $relative, $absolute );
			if ( ! is_wp_error( $item ) ) {
				$this->database->upsert_asset( $item );
				$seen[ $item['id'] ] = true;
			}
		}
		$this->database->mark_missing_under( 'local', $mount, $path, $seen );
		$this->database->add_activity( 'rescan', 'local', $mount, $path, null, array( 'count' => $count ) );
		return array( 'scanned' => $count, 'truncated' => $count > 20000 );
	}

	public function absolute_for_stream( array $args ) {
		$location = $this->location( $args, true );
		if ( is_wp_error( $location ) ) {
			return $location;
		}
		if ( ! is_file( $location['absolute'] ) ) {
			return new WP_Error( 'kodety_fs_not_file', __( 'The requested path is not a file.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		return array_merge( $location, array( 'mime' => $this->detect_mime( $location['absolute'], $location['path'] ), 'size' => filesize( $location['absolute'] ) ) );
	}

	/** @return array<string,mixed>|WP_Error */
	private function location( array $args, bool $must_exist ) {
		$mount = sanitize_key( (string) ( $args['mount'] ?? 'project' ) );
		$path  = $this->guard->normalize_relative( (string) ( $args['path'] ?? '' ), true );
		if ( is_wp_error( $path ) ) {
			return $path;
		}
		$root = $this->mount_root( $mount );
		if ( is_wp_error( $root ) ) {
			return $root;
		}
		$absolute = $this->guard->resolve( $root, $path, $must_exist );
		if ( is_wp_error( $absolute ) ) {
			return $absolute;
		}
		return array( 'mount' => $mount, 'path' => $path, 'root' => $root, 'absolute' => $absolute );
	}

	/** @return array<string,mixed>|WP_Error */
	private function item_from_path( string $mount, string $relative, string $absolute, bool $detailed = true ) {
		if ( is_link( $absolute ) ) {
			return new WP_Error( 'kodety_fs_symlink', __( 'Symbolic links are not allowed.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		$stat = @stat( $absolute );
		if ( false === $stat ) {
			return new WP_Error( 'kodety_fs_stat_failed', __( 'The file information could not be read.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		$is_dir    = is_dir( $absolute );
		$name      = '' === $relative ? ucfirst( $mount ) : wp_basename( $relative );
		$mime      = $is_dir ? 'inode/directory' : ( $detailed ? $this->detect_mime( $absolute, $relative ) : $this->detect_mime_from_name( $relative ) );
		$asset_key = $this->database->asset_key( 'local', $mount, $relative );
		$metadata  = $this->database->metadata( $asset_key );
		$cached = null;
		if ( ! $detailed && method_exists( $this->database, 'asset_by_key' ) ) {
			$indexed = $this->database->asset_by_key( $asset_key );
			$indexed_time = is_array( $indexed ) && ! empty( $indexed['updatedAt'] ) ? strtotime( (string) $indexed['updatedAt'] ) : false;
			if ( is_array( $indexed )
				&& (int) ( $indexed['size'] ?? -1 ) === ( $is_dir ? 0 : (int) $stat['size'] )
				&& false !== $indexed_time
				&& abs( $indexed_time - (int) $stat['mtime'] ) <= 2 ) {
				$cached = $indexed;
				if ( ! $is_dir && ! empty( $cached['mimeType'] ) ) {
					$mime = (string) $cached['mimeType'];
				}
			}
		}
		$public_policy = 'public' === $mount && ! $is_dir ? $this->validate_public_asset( $relative, $mime ) : true;
		$public    = 'public' === $mount && ! $is_dir && ! is_wp_error( $public_policy ) ? $this->public_url( $relative ) : null;
		$preview   = $is_dir ? null : add_query_arg( array( 'mount' => $mount, 'path' => $relative ), rest_url( KODETY_FS_REST_NAMESPACE . '/preview' ) );
		$item      = array(
			'id'          => $asset_key,
			'name'        => $name,
			'path'        => $relative,
			'kind'        => $is_dir ? 'folder' : 'file',
			'mimeType'    => $mime,
			'size'        => $is_dir ? 0 : (int) $stat['size'],
			'mount'       => $mount,
			'provider'    => 'local',
			'visibility'  => 'public' === $mount ? 'public' : 'private',
			'publicUrl'   => $public,
			'previewUrl'  => $preview,
			'updatedAt'   => gmdate( DATE_RFC3339, (int) $stat['mtime'] ),
			'createdAt'   => gmdate( DATE_RFC3339, (int) $stat['ctime'] ),
			'favorite'    => $metadata['favorite'],
			'tags'        => $metadata['tags'],
			'permissions' => $this->permissions_for_mount( $mount ),
		);
		if ( $detailed && ! $is_dir && (int) $stat['size'] <= 64 * MB_IN_BYTES ) {
			$item['checksum'] = (string) @hash_file( 'sha256', $absolute );
		}
		if ( $detailed && ! $is_dir && str_starts_with( $mime, 'image/' ) && 'image/svg+xml' !== $mime ) {
			$dimensions = @getimagesize( $absolute );
			if ( is_array( $dimensions ) ) {
				$item['width']  = (int) $dimensions[0];
				$item['height'] = (int) $dimensions[1];
			}
		}
		if ( ! $detailed && is_array( $cached ) ) {
			if ( ! empty( $cached['checksum'] ) ) { $item['checksum'] = (string) $cached['checksum']; }
			if ( isset( $cached['width'] ) && null !== $cached['width'] ) { $item['width'] = (int) $cached['width']; }
			if ( isset( $cached['height'] ) && null !== $cached['height'] ) { $item['height'] = (int) $cached['height']; }
		}
		return $item;
	}

	private function permissions_for_mount( string $mount ): array {
		$system_available = self::private_storage_available();
		return array(
			'read'   => current_user_can( 'kodety_files_read' ),
			'write'  => current_user_can( 'kodety_files_edit' ) && ( 'private' !== $mount || current_user_can( 'kodety_files_manage_private' ) ),
			'upload' => current_user_can( 'kodety_files_upload' ) && ( 'private' !== $mount || current_user_can( 'kodety_files_manage_private' ) ),
			'delete' => $system_available && current_user_can( 'kodety_files_delete' ) && ( 'private' !== $mount || current_user_can( 'kodety_files_manage_private' ) ),
			'versions' => $system_available && current_user_can( 'kodety_files_edit' ),
			'visibility' => $system_available && current_user_can( 'kodety_files_manage_private' ),
		);
	}

	private function should_skip_list_entry( string $mount, SplFileInfo $entry ): bool {
		$name = $entry->getFilename();
		if ( in_array( strtolower( $name ), array( '.htaccess', 'web.config', 'index.php' ), true ) ) {
			return true;
		}
		if ( ! str_starts_with( $name, '.' ) ) {
			return false;
		}
		return $entry->isDir()
			|| ! $this->guard->is_allowed_environment_name( $name )
			|| ! $this->dangerous_file_editing_allowed( $mount );
	}

	private function public_url( string $relative ): ?string {
		$filtered = apply_filters( 'kodety_fs_public_base_url', null, $this->root );
		if ( is_string( $filtered ) && '' !== $filtered ) {
			return trailingslashit( $filtered ) . str_replace( '%2F', '/', rawurlencode( $relative ) );
		}
		$uploads = wp_upload_dir();
		$default_root = untrailingslashit( wp_normalize_path( trailingslashit( $uploads['basedir'] ) . 'kodety-file-system' ) );
		if ( $this->root !== $default_root ) {
			return null;
		}
		$segments = array_map( 'rawurlencode', explode( '/', $relative ) );
		return trailingslashit( $uploads['baseurl'] ) . 'kodety-file-system/public/' . implode( '/', $segments );
	}

	private function detect_mime( string $absolute, string $name ): string {
		if ( 'svg' === strtolower( pathinfo( $name, PATHINFO_EXTENSION ) ) ) {
			return 'image/svg+xml';
		}
		if ( function_exists( 'finfo_open' ) ) {
			$finfo = finfo_open( FILEINFO_MIME_TYPE );
			$mime  = $finfo ? finfo_file( $finfo, $absolute ) : false;
			if ( $finfo ) {
				finfo_close( $finfo );
			}
			if ( is_string( $mime ) && '' !== $mime ) {
				return $mime;
			}
		}
		$type = wp_check_filetype( $name );
		return $type['type'] ?: 'application/octet-stream';
	}

	private function detect_mime_from_name( string $name ): string {
		if ( 'svg' === strtolower( pathinfo( $name, PATHINFO_EXTENSION ) ) ) {
			return 'image/svg+xml';
		}
		$type = wp_check_filetype( $name );
		return $type['type'] ?: 'application/octet-stream';
	}

	/** @return string|WP_Error */
	private function validate_content_for_location( string $mount, string $path, string $content ) {
		$sensitive = $this->validate_code_mutation_target( $mount, $path );
		if ( is_wp_error( $sensitive ) ) {
			return $sensitive;
		}
		if ( 'public' === $mount ) {
			$public_policy = $this->validate_public_asset( $path, $this->detect_mime_from_content( $content, $path ) );
			if ( is_wp_error( $public_policy ) ) {
				return $public_policy;
			}
		}
		if ( 'svg' === strtolower( pathinfo( $path, PATHINFO_EXTENSION ) ) ) {
			return $this->guard->sanitize_svg( $content );
		}
		return $content;
	}

	/** @return true|WP_Error */
	private function validate_code_mutation_target( string $mount, string $path ) {
		$segments = explode( '.', strtolower( wp_basename( $path ) ) );
		array_shift( $segments );
		if ( ! empty( array_intersect( $segments, self::CODE_MUTATION_EXTENSIONS ) ) && ! current_user_can( 'kodety_files_edit_code' ) ) {
			return new WP_Error( 'kodety_fs_code_edit_forbidden', __( 'Creating or changing code files requires the Onun Kodety code-editing capability.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		return $this->validate_sensitive_target( $mount, $path );
	}

	/** @return true|WP_Error */
	private function validate_sensitive_target( string $mount, string $path ) {
		if ( ! $this->guard->is_dangerous_edit_name( wp_basename( $path ) ) ) {
			return true;
		}
		if ( ! $this->dangerous_file_editing_allowed( $mount ) ) {
			return new WP_Error( 'kodety_fs_dangerous_edit_disabled', __( 'This sensitive file type requires explicit dangerous-file editing permission in a protected mount.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		return true;
	}

	private function dangerous_file_editing_allowed( string $mount ): bool {
		return defined( 'KODETY_FS_ENABLE_DANGEROUS_FILE_EDITING' )
			&& true === KODETY_FS_ENABLE_DANGEROUS_FILE_EDITING
			&& current_user_can( 'kodety_files_edit_code' )
			&& in_array( $mount, array( 'project', 'private', 'imports' ), true );
	}

	/** @return true|WP_Error */
	private function validate_public_asset( string $name, string $mime = '' ) {
		return self::validate_public_asset_policy( $this->guard, $this->root, $name, $mime );
	}

	/** @return true|WP_Error */
	private static function validate_public_asset_policy( Kodety_FS_Path_Guard $guard, string $root, string $name, string $mime = '' ) {
		if ( $guard->is_executable_public_name( $name ) || $guard->is_forbidden_server_name( wp_basename( $name ) ) || preg_match( '~(?:php|x-httpd|x-executable|x-sharedlib|x-shellscript|x-msdownload|x-asp)~i', $mime ) ) {
			return new WP_Error( 'kodety_fs_public_executable', __( 'Executable files cannot be stored in the public mount.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		$extension = strtolower( pathinfo( $name, PATHINFO_EXTENSION ) );
		$active_mime = (bool) preg_match( '~^(?:text/html|application/xhtml\+xml|image/svg\+xml|(?:application|text)/(?:javascript|ecmascript))$~i', trim( $mime ) );
		$active = $guard->is_active_public_name( $name ) || $active_mime;
		if ( $active && ! self::public_active_content_allowed_for_root( $root, $guard ) ) {
			return new WP_Error( 'kodety_fs_public_active_content', __( 'Active HTML, JavaScript, SVG and XML assets require an explicitly trusted, separate public asset origin.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		if ( ! $active && ! in_array( $extension, self::PASSIVE_PUBLIC_EXTENSIONS, true ) ) {
			return new WP_Error( 'kodety_fs_public_file_type', __( 'This file type is not allowed in the public asset mount.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		return true;
	}

	private function detect_mime_from_content( string $content, string $name ): string {
		if ( 'svg' === strtolower( pathinfo( $name, PATHINFO_EXTENSION ) ) ) {
			return 'image/svg+xml';
		}
		if ( function_exists( 'finfo_open' ) ) {
			$finfo = finfo_open( FILEINFO_MIME_TYPE );
			$mime  = $finfo ? finfo_buffer( $finfo, $content ) : false;
			if ( $finfo ) {
				finfo_close( $finfo );
			}
			if ( is_string( $mime ) && '' !== $mime ) {
				return $mime;
			}
		}
		$type = wp_check_filetype( $name );
		return $type['type'] ?: 'application/octet-stream';
	}

	private function public_active_content_allowed(): bool {
		return self::public_active_content_allowed_for_root( $this->root, $this->guard );
	}

	private static function public_active_content_allowed_for_root( string $root, Kodety_FS_Path_Guard $guard ): bool {
		if ( ! defined( 'KODETY_FS_ALLOW_PUBLIC_ACTIVE_CONTENT' ) || true !== KODETY_FS_ALLOW_PUBLIC_ACTIVE_CONTENT ) {
			return false;
		}
		$base = apply_filters( 'kodety_fs_public_base_url', null, $root );
		if ( ! is_string( $base ) || '' === $base || ! wp_http_validate_url( $base ) ) {
			return false;
		}
		$asset = wp_parse_url( $base );
		if ( ! is_array( $asset )
			|| 'https' !== strtolower( (string) ( $asset['scheme'] ?? '' ) )
			|| '' === (string) ( $asset['host'] ?? '' ) ) {
			return false;
		}
		$wordpress_hosts = array();
		foreach ( array( home_url( '/' ), site_url( '/' ), admin_url( '/' ), rest_url() ) as $wordpress_url ) {
			$parts = wp_parse_url( $wordpress_url );
			if ( is_array( $parts ) && ! empty( $parts['host'] ) ) {
				$wordpress_hosts[] = strtolower( (string) $parts['host'] );
			}
		}
		$http_host = strtolower( preg_replace( '/:\d+$/', '', (string) ( $_SERVER['HTTP_HOST'] ?? '' ) ) );
		if ( '' !== $http_host ) { $wordpress_hosts[] = $http_host; }
		if ( in_array( strtolower( (string) $asset['host'] ), array_unique( $wordpress_hosts ), true ) ) {
			return false;
		}
		$public_root = realpath( $root . '/public' );
		if ( false === $public_root || is_link( $root ) || is_link( $root . '/public' ) ) {
			return false;
		}
		$public_root = wp_normalize_path( $public_root );
		$document_roots = array( ABSPATH, (string) ( $_SERVER['DOCUMENT_ROOT'] ?? '' ) );
		foreach ( array_filter( $document_roots ) as $document_root ) {
			$resolved = realpath( $document_root );
			if ( false !== $resolved && $guard->is_within( wp_normalize_path( $resolved ), $public_root ) ) {
				return false;
			}
		}
		return true;
	}

	/** @return true|WP_Error */
	private function atomic_write( string $destination, string $content ) {
		wp_mkdir_p( dirname( $destination ) );
		$temp = dirname( $destination ) . '/.kodety-' . wp_generate_uuid4() . '.part';
		$handle = @fopen( $temp, 'xb' );
		if ( false === $handle ) {
			return new WP_Error( 'kodety_fs_temp_failed', __( 'A temporary file could not be created.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		$ok = flock( $handle, LOCK_EX );
		$offset = 0;
		$length = strlen( $content );
		while ( $ok && $offset < $length ) {
			$written = fwrite( $handle, substr( $content, $offset, 1024 * 1024 ) );
			if ( false === $written || 0 === $written ) {
				$ok = false;
				break;
			}
			$offset += $written;
		}
		$ok = $ok && $offset === $length && fflush( $handle );
		if ( $ok && function_exists( 'fsync' ) ) {
			$ok = fsync( $handle );
		}
		flock( $handle, LOCK_UN );
		fclose( $handle );
		if ( ! $ok || ! @rename( $temp, $destination ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.rename_rename
			@unlink( $temp );
			return new WP_Error( 'kodety_fs_write_failed', __( 'The file could not be written atomically.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		@chmod( $destination, 0640 );
		return true;
	}

	/** @return true|WP_Error */
	private function atomic_copy( string $source, string $destination ) {
		if ( ! is_file( $source ) || is_link( $source ) || ! is_readable( $source ) ) {
			return new WP_Error( 'kodety_fs_copy_source', __( 'The source file is unavailable.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		wp_mkdir_p( dirname( $destination ) );
		$temp = dirname( $destination ) . '/.kodety-' . wp_generate_uuid4() . '.part';
		$input = @fopen( $source, 'rb' );
		$output = @fopen( $temp, 'xb' );
		if ( false === $input || false === $output ) {
			if ( is_resource( $input ) ) { fclose( $input ); }
			if ( is_resource( $output ) ) { fclose( $output ); }
			@unlink( $temp );
			return new WP_Error( 'kodety_fs_temp_failed', __( 'A temporary file could not be created.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		$expected = @filesize( $source );
		$locked = flock( $output, LOCK_EX );
		$copied = $locked ? stream_copy_to_stream( $input, $output ) : false;
		$ok = false !== $copied && false !== $expected && (int) $copied === (int) $expected && fflush( $output );
		if ( $ok && function_exists( 'fsync' ) ) {
			$ok = fsync( $output );
		}
		if ( $locked ) { flock( $output, LOCK_UN ); }
		fclose( $input );
		fclose( $output );
		if ( ! $ok || ! @rename( $temp, $destination ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.rename_rename
			@unlink( $temp );
			return new WP_Error( 'kodety_fs_copy_failed', __( 'The file could not be copied atomically.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		@chmod( $destination, 0640 );
		return true;
	}

	/** @return true|WP_Error */
	private function acquire_mutation_lock() {
		if ( is_resource( $this->mutation_lock ) ) {
			return true;
		}
		$lock_directory = self::private_storage_available() ? $this->system_root . '/temp' : $this->root;
		if ( ! is_dir( $lock_directory ) && ! wp_mkdir_p( $lock_directory ) ) {
			return new WP_Error( 'kodety_fs_mutation_lock', __( 'The storage mutation lock directory is unavailable.', 'kodety-file-system' ), array( 'status' => 503 ) );
		}
		$lock_path = $lock_directory . '/.kodety-mutation.lock';
		if ( is_link( $lock_path ) || file_exists( $lock_path ) && ! is_file( $lock_path ) ) {
			return new WP_Error( 'kodety_fs_mutation_lock', __( 'The storage mutation lock is unsafe.', 'kodety-file-system' ), array( 'status' => 503 ) );
		}
		$handle = @fopen( $lock_path, 'c+b' );
		if ( false === $handle ) {
			return new WP_Error( 'kodety_fs_mutation_lock', __( 'The storage mutation lock could not be opened.', 'kodety-file-system' ), array( 'status' => 503 ) );
		}
		$wait_ms = min( 10000, max( 0, (int) apply_filters( 'kodety_fs_mutation_lock_wait_ms', 3000 ) ) );
		$deadline = microtime( true ) + $wait_ms / 1000;
		do {
			$locked = flock( $handle, LOCK_EX | LOCK_NB );
			if ( $locked ) { break; }
			if ( microtime( true ) >= $deadline ) { break; }
			usleep( 25000 );
		} while ( true );
		if ( ! $locked ) {
			fclose( $handle );
			return new WP_Error( 'kodety_fs_mutation_busy', __( 'Another storage mutation is in progress. Try again shortly.', 'kodety-file-system' ), array( 'status' => 423 ) );
		}
		$stat = @lstat( $lock_path );
		if ( is_link( $lock_path ) || ! is_array( $stat ) || (int) ( $stat['nlink'] ?? 1 ) > 1 ) {
			flock( $handle, LOCK_UN );
			fclose( $handle );
			return new WP_Error( 'kodety_fs_mutation_lock', __( 'The storage mutation lock failed its integrity check.', 'kodety-file-system' ), array( 'status' => 503 ) );
		}
		@chmod( $lock_path, 0600 );
		$this->mutation_lock = $handle;
		return true;
	}

	/**
	 * Snapshot chunk-upload reservations while holding the same global lock used
	 * by filesystem mutations. `outstandingBytes` excludes bytes already present
	 * on disk, while `reservedBytes` is suitable for allocator/user quotas.
	 *
	 * @return array{sessions:int,reservedBytes:int,outstandingBytes:int,byUser:array<int,array{sessions:int,reservedBytes:int,outstandingBytes:int}>}|WP_Error
	 */
	public function upload_reservation_usage( ?string $exclude_upload_id = null ) {
		$lock = $this->acquire_mutation_lock();
		if ( is_wp_error( $lock ) ) {
			return $lock;
		}
		if ( null !== $exclude_upload_id && ! preg_match( '/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/', $exclude_upload_id ) ) {
			return new WP_Error( 'kodety_fs_upload_reservation_exclusion', __( 'The upload reservation exclusion is invalid.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		$upload_root = $this->system_root . '/uploads';
		$result = array( 'sessions' => 0, 'reservedBytes' => 0, 'outstandingBytes' => 0, 'byUser' => array() );
		if ( ! is_dir( $upload_root ) ) {
			return $result;
		}
		$limit = min( 10000, max( 10, (int) apply_filters( 'kodety_fs_upload_reservation_scan_limit', 1000 ) ) );
		$deadline = microtime( true ) + min( 10.0, max( 0.25, (float) apply_filters( 'kodety_fs_upload_reservation_deadline_seconds', 2.0 ) ) );
		$visited_sessions = 0;
		try {
			foreach ( new FilesystemIterator( $upload_root, FilesystemIterator::SKIP_DOTS ) as $entry ) {
				if ( ! $entry->isDir() || $entry->isLink() || ! preg_match( '/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/', $entry->getFilename() ) ) {
					continue;
				}
				if ( ++$visited_sessions > $limit || microtime( true ) >= $deadline ) {
					return new WP_Error( 'kodety_fs_upload_reservation_limit', __( 'Active upload reservations could not be measured within the safety bounds.', 'kodety-file-system' ), array( 'status' => 503 ) );
				}
				$meta_path = $entry->getPathname() . '/meta.json';
				$payload_path = $entry->getPathname() . '/payload.part';
				if ( ! is_file( $meta_path ) || is_link( $meta_path ) || is_link( $payload_path ) || (int) @filesize( $meta_path ) > 64 * KB_IN_BYTES ) {
					return new WP_Error( 'kodety_fs_upload_reservation_unsafe', __( 'An active upload reservation is malformed or unsafe.', 'kodety-file-system' ), array( 'status' => 503 ) );
				}
				$meta_handle = @fopen( $meta_path, 'rb' );
				if ( false === $meta_handle || ! flock( $meta_handle, LOCK_SH | LOCK_NB ) ) {
					if ( is_resource( $meta_handle ) ) { fclose( $meta_handle ); }
					return new WP_Error( 'kodety_fs_upload_reservation_busy', __( 'An upload reservation is being updated. Try again shortly.', 'kodety-file-system' ), array( 'status' => 423 ) );
				}
				$meta_json = stream_get_contents( $meta_handle, 64 * KB_IN_BYTES + 1 );
				flock( $meta_handle, LOCK_UN );
				fclose( $meta_handle );
				$meta = is_string( $meta_json ) ? json_decode( $meta_json, true ) : null;
				if ( ! is_array( $meta ) || ! isset( $meta['size'], $meta['userId'], $meta['chunkSize'], $meta['chunks'], $meta['received'] ) || ! is_int( $meta['size'] ) || ! is_int( $meta['userId'] ) ) {
					return new WP_Error( 'kodety_fs_upload_reservation_unsafe', __( 'An active upload reservation has invalid metadata.', 'kodety-file-system' ), array( 'status' => 503 ) );
				}
				$reserved = $meta['size'];
				$written = $this->validated_upload_received_bytes( $meta, $payload_path );
				if ( is_wp_error( $written ) ) {
					return $written;
				}
				$outstanding = max( 0, $reserved - $written );
				// A reservation may be removed from the quota equation only once all
				// declared bytes have been received. Partial sessions remain reserved
				// even if a caller presents their payload path to import_path().
				if ( null !== $exclude_upload_id && hash_equals( $exclude_upload_id, $entry->getFilename() ) && $written === $reserved ) {
					continue;
				}
				if ( $result['reservedBytes'] > PHP_INT_MAX - $reserved || $result['outstandingBytes'] > PHP_INT_MAX - $outstanding ) {
					return new WP_Error( 'kodety_fs_upload_reservation_overflow', __( 'Upload reservations are too large to measure safely.', 'kodety-file-system' ), array( 'status' => 503 ) );
				}
				++$result['sessions'];
				$result['reservedBytes'] += $reserved;
				$result['outstandingBytes'] += $outstanding;
				$user_id = max( 0, (int) $meta['userId'] );
				if ( ! isset( $result['byUser'][ $user_id ] ) ) {
					$result['byUser'][ $user_id ] = array( 'sessions' => 0, 'reservedBytes' => 0, 'outstandingBytes' => 0 );
				}
				++$result['byUser'][ $user_id ]['sessions'];
				$result['byUser'][ $user_id ]['reservedBytes'] += $reserved;
				$result['byUser'][ $user_id ]['outstandingBytes'] += $outstanding;
			}
		} catch ( UnexpectedValueException $exception ) {
			return new WP_Error( 'kodety_fs_upload_reservation_failed', $exception->getMessage(), array( 'status' => 503 ) );
		}
		return $result;
	}

	/** @return int|WP_Error */
	private function validated_upload_received_bytes( array $meta, string $payload_path ) {
		$size       = $meta['size'] ?? null;
		$chunk_size = $meta['chunkSize'] ?? null;
		$chunks     = $meta['chunks'] ?? null;
		$received   = $meta['received'] ?? null;
		$max_upload = max( 0, (int) apply_filters( 'kodety_fs_max_chunked_upload_bytes', 5 * GB_IN_BYTES ) );
		if ( ! is_int( $size ) || $size < 0 || $size > $max_upload || ! is_int( $chunk_size ) || $chunk_size <= 0 || ! is_int( $chunks ) || $chunks < 0 || ! is_array( $received ) ) {
			return new WP_Error( 'kodety_fs_upload_reservation_unsafe', __( 'An active upload reservation has invalid chunk metadata.', 'kodety-file-system' ), array( 'status' => 503 ) );
		}
		$expected_chunks = 0 === $size ? 0 : intdiv( $size, $chunk_size ) + ( 0 === $size % $chunk_size ? 0 : 1 );
		if ( $chunks !== $expected_chunks || count( $received ) > $chunks ) {
			return new WP_Error( 'kodety_fs_upload_reservation_unsafe', __( 'An active upload reservation has inconsistent chunk metadata.', 'kodety-file-system' ), array( 'status' => 503 ) );
		}
		$payload_stat = @lstat( $payload_path );
		if ( ! is_array( $payload_stat ) || ! is_file( $payload_path ) || is_link( $payload_path ) || (int) ( $payload_stat['nlink'] ?? 1 ) > 1 ) {
			return new WP_Error( 'kodety_fs_upload_reservation_unsafe', __( 'An active upload reservation payload is unavailable or unsafe.', 'kodety-file-system' ), array( 'status' => 503 ) );
		}
		$payload_size = (int) ( $payload_stat['size'] ?? -1 );
		if ( $payload_size < 0 || $payload_size > $size ) {
			return new WP_Error( 'kodety_fs_upload_reservation_unsafe', __( 'An active upload reservation payload has an invalid size.', 'kodety-file-system' ), array( 'status' => 503 ) );
		}
		$written = 0;
		$highest_received_end = 0;
		foreach ( $received as $index_value => $byte_count ) {
			if ( is_int( $index_value ) ) {
				$index = $index_value;
			} elseif ( is_string( $index_value ) && preg_match( '/^(?:0|[1-9][0-9]*)$/', $index_value ) ) {
				$index = (int) $index_value;
			} else {
				return new WP_Error( 'kodety_fs_upload_reservation_unsafe', __( 'An active upload reservation contains an invalid chunk index.', 'kodety-file-system' ), array( 'status' => 503 ) );
			}
			if ( $index < 0 || $index >= $chunks || ! is_int( $byte_count ) ) {
				return new WP_Error( 'kodety_fs_upload_reservation_unsafe', __( 'An active upload reservation contains invalid received chunk data.', 'kodety-file-system' ), array( 'status' => 503 ) );
			}
			$start = $index * $chunk_size;
			$expected_bytes = min( $chunk_size, $size - $start );
			if ( $byte_count !== $expected_bytes || $written > PHP_INT_MAX - $byte_count ) {
				return new WP_Error( 'kodety_fs_upload_reservation_unsafe', __( 'An active upload reservation contains inconsistent received byte counts.', 'kodety-file-system' ), array( 'status' => 503 ) );
			}
			$written += $byte_count;
			$highest_received_end = max( $highest_received_end, $start + $byte_count );
		}
		if ( $written > $size || $payload_size < $highest_received_end || 0 === $size && 0 !== $payload_size ) {
			return new WP_Error( 'kodety_fs_upload_reservation_unsafe', __( 'An active upload reservation payload does not match its received chunks.', 'kodety-file-system' ), array( 'status' => 503 ) );
		}
		return $written;
	}

	private function upload_reservation_id_for_source( string $source ): ?string {
		$upload_root = realpath( $this->system_root . '/uploads' );
		$source_real = realpath( $source );
		if ( false === $upload_root || false === $source_real ) {
			return null;
		}
		$upload_root = untrailingslashit( wp_normalize_path( $upload_root ) );
		$source_real = wp_normalize_path( $source_real );
		if ( ! $this->guard->is_within( $upload_root, $source_real ) ) {
			return null;
		}
		$relative = ltrim( substr( $source_real, strlen( $upload_root ) ), '/' );
		if ( ! preg_match( '#^([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})/payload\.part$#', $relative, $matches ) ) {
			return null;
		}
		$session_dir = dirname( $source_real );
		$meta_path = $session_dir . '/meta.json';
		if ( is_link( $session_dir ) || ! is_file( $meta_path ) || is_link( $meta_path ) ) {
			return null;
		}
		return $matches[1];
	}

	/**
	 * Refuse mutations that would consume the filesystem safety reserve or an
	 * explicitly configured logical storage quota. The optional quota is
	 * disabled by default and can be set with KODETY_FS_STORAGE_QUOTA_BYTES or
	 * the kodety_fs_storage_quota_bytes filter.
	 *
	 * @return true|WP_Error
	 */
	private function ensure_capacity( int $peak_bytes, string $target, ?int $quota_growth = null ) {
		$lock = $this->acquire_mutation_lock();
		if ( is_wp_error( $lock ) ) {
			return $lock;
		}
		$peak_bytes  = max( 0, $peak_bytes );
		$quota_growth = max( 0, null === $quota_growth ? $peak_bytes : $quota_growth );
		$probe = $this->existing_ancestor( $target );
		if ( null === $probe ) {
			return new WP_Error( 'kodety_fs_capacity_unknown', __( 'The destination filesystem capacity could not be determined.', 'kodety-file-system' ), array( 'status' => 507 ) );
		}

		// Snapshot logical upload progress before reading disk capacity. Chunk
		// writers do not take the mutation lock: this ordering makes a chunk that
		// lands between the two reads reduce free space while its old outstanding
		// reservation is still counted (conservative), instead of counting neither.
		$reservations = $this->upload_reservation_usage( $this->capacity_reservation_exclusion );
		if ( is_wp_error( $reservations ) ) {
			return $reservations;
		}
		$free  = @disk_free_space( $probe );
		$total = @disk_total_space( $probe );
		$require_check = (bool) apply_filters( 'kodety_fs_require_disk_capacity_check', true, $target );
		if ( false === $free ) {
			if ( $require_check ) {
				return new WP_Error( 'kodety_fs_capacity_unknown', __( 'The destination filesystem did not report its available capacity.', 'kodety-file-system' ), array( 'status' => 507 ) );
			}
		} else {
			$outstanding_reserved = max( 0, (int) $reservations['outstandingBytes'] );
			$default_reserve = min( GB_IN_BYTES, max( 64 * MB_IN_BYTES, (int) floor( (float) $free * 0.05 ) ) );
			$reserve = max( 0, (int) apply_filters( 'kodety_fs_min_free_bytes', $default_reserve, $target, $free, $total ) );
			$available_after_reservations = $outstanding_reserved > (int) $free ? -1 : (int) $free - $outstanding_reserved;
			if ( $available_after_reservations < 0 || $peak_bytes > $available_after_reservations || $reserve > $available_after_reservations - $peak_bytes ) {
				return new WP_Error(
					'kodety_fs_insufficient_storage',
					__( 'There is not enough free storage to complete this operation safely.', 'kodety-file-system' ),
					array( 'status' => 507, 'requiredBytes' => $peak_bytes, 'freeBytes' => (int) $free, 'reservedBytes' => $outstanding_reserved, 'reserveBytes' => $reserve )
				);
			}
		}

		$quota = defined( 'KODETY_FS_STORAGE_QUOTA_BYTES' ) && is_numeric( KODETY_FS_STORAGE_QUOTA_BYTES )
			? max( 0, (int) KODETY_FS_STORAGE_QUOTA_BYTES )
			: 0;
		$quota = max( 0, (int) apply_filters( 'kodety_fs_storage_quota_bytes', $quota ) );
		if ( $quota > 0 && $quota_growth > 0 ) {
			$usage = $this->managed_storage_usage();
			if ( is_wp_error( $usage ) ) {
				return $usage;
			}
			$reserved = max( 0, (int) $reservations['reservedBytes'] );
			if ( $usage['bytes'] > PHP_INT_MAX - $reserved ) {
				return new WP_Error( 'kodety_fs_storage_quota', __( 'The configured Onun Kodety storage quota could not be measured safely.', 'kodety-file-system' ), array( 'status' => 507 ) );
			}
			$committed_and_reserved = $usage['bytes'] + $reserved;
			if ( $quota_growth > $quota || $committed_and_reserved > $quota - $quota_growth ) {
				return new WP_Error(
					'kodety_fs_storage_quota',
					__( 'The configured Onun Kodety storage quota would be exceeded.', 'kodety-file-system' ),
					array( 'status' => 507, 'quotaBytes' => $quota, 'usedBytes' => $usage['bytes'], 'reservedBytes' => $reserved, 'requestedBytes' => $quota_growth )
				);
			}
		}
		return true;
	}

	/** @return array{bytes:int,entries:int}|WP_Error */
	private function managed_storage_usage() {
		$roots = array();
		$logical_roots = array(
			$this->root . '/public',
			$this->private_root . '/projects',
			$this->private_root . '/private',
			$this->private_root . '/imports',
			$this->private_root . '/trash',
			$this->private_root . '/versions',
		);
		foreach ( $logical_roots as $candidate ) {
			$resolved = realpath( $candidate );
			if ( false === $resolved ) {
				continue;
			}
			$resolved = untrailingslashit( wp_normalize_path( $resolved ) );
			$covered = false;
			foreach ( $roots as $index => $existing ) {
				if ( $this->guard->is_within( $existing, $resolved ) ) {
					$covered = true;
					break;
				}
				if ( $this->guard->is_within( $resolved, $existing ) ) {
					unset( $roots[ $index ] );
				}
			}
			if ( ! $covered ) {
				$roots[] = $resolved;
			}
		}
		$limit = min( 1000000, max( 1000, (int) apply_filters( 'kodety_fs_quota_scan_limit', 100000 ) ) );
		$seconds = min( 30.0, max( 0.5, (float) apply_filters( 'kodety_fs_quota_scan_deadline_seconds', 5.0 ) ) );
		$usage = $this->measure_paths( array_values( $roots ), $limit, $seconds );
		if ( is_wp_error( $usage ) ) {
			return new WP_Error( 'kodety_fs_quota_scan_failed', __( 'Storage usage could not be measured within the configured safety bounds.', 'kodety-file-system' ), array( 'status' => 503, 'cause' => $usage->get_error_code() ) );
		}
		return $usage;
	}

	/** @return array{bytes:int,entries:int}|WP_Error */
	private function measure_paths( array $paths, ?int $entry_limit = null, ?float $deadline_seconds = null ) {
		$entry_limit = null === $entry_limit
			? min( 200000, max( 100, (int) apply_filters( 'kodety_fs_mutation_scan_limit', 20000 ) ) )
			: max( 1, $entry_limit );
		$deadline_seconds = null === $deadline_seconds
			? min( 30.0, max( 0.5, (float) apply_filters( 'kodety_fs_mutation_scan_deadline_seconds', 5.0 ) ) )
			: max( 0.1, $deadline_seconds );
		$deadline = microtime( true ) + $deadline_seconds;
		$stack = array_values( $paths );
		$bytes = 0;
		$entries = 0;

		try {
			while ( $stack ) {
				if ( ++$entries > $entry_limit || microtime( true ) >= $deadline ) {
					return new WP_Error( 'kodety_fs_measure_limit', __( 'The operation exceeds its item or processing-time safety limit.', 'kodety-file-system' ), array( 'status' => 413, 'limit' => $entry_limit ) );
				}
				$path = array_pop( $stack );
				$stat = @lstat( $path );
				if ( ! is_array( $stat ) || is_link( $path ) ) {
					return new WP_Error( 'kodety_fs_measure_unsafe', __( 'The operation contains an unavailable item or symbolic link.', 'kodety-file-system' ), array( 'status' => 400 ) );
				}
				if ( is_file( $path ) ) {
					if ( (int) ( $stat['nlink'] ?? 1 ) > 1 ) {
						return new WP_Error( 'kodety_fs_hardlink', __( 'Hard-linked files are not supported by this operation.', 'kodety-file-system' ), array( 'status' => 403 ) );
					}
					$size = max( 0, (int) ( $stat['size'] ?? 0 ) );
					if ( $bytes > PHP_INT_MAX - $size ) {
						return new WP_Error( 'kodety_fs_measure_overflow', __( 'The operation size could not be represented safely.', 'kodety-file-system' ), array( 'status' => 413 ) );
					}
					$bytes += $size;
					continue;
				}
				if ( ! is_dir( $path ) ) {
					return new WP_Error( 'kodety_fs_measure_unsafe', __( 'The operation contains an unsupported filesystem item.', 'kodety-file-system' ), array( 'status' => 400 ) );
				}
				foreach ( new FilesystemIterator( $path, FilesystemIterator::SKIP_DOTS ) as $entry ) {
					$stack[] = $entry->getPathname();
				}
			}
		} catch ( UnexpectedValueException $exception ) {
			return new WP_Error( 'kodety_fs_measure_failed', $exception->getMessage(), array( 'status' => 500 ) );
		}
		return array( 'bytes' => $bytes, 'entries' => $entries );
	}

	private function existing_ancestor( string $path ): ?string {
		$probe = is_dir( $path ) ? $path : dirname( $path );
		while ( ! file_exists( $probe ) ) {
			$parent = dirname( $probe );
			if ( $parent === $probe || '.' === $parent ) {
				return null;
			}
			$probe = $parent;
		}
		return is_dir( $probe ) && ! is_link( $probe ) ? $probe : null;
	}

	private function same_filesystem( string $source, string $destination ): bool {
		$destination_ancestor = $this->existing_ancestor( $destination );
		$source_stat = @lstat( $source );
		$destination_stat = null === $destination_ancestor ? false : @stat( $destination_ancestor );
		return is_array( $source_stat ) && is_array( $destination_stat ) && isset( $source_stat['dev'], $destination_stat['dev'] ) && (int) $source_stat['dev'] === (int) $destination_stat['dev'];
	}

	/** @return array<string,mixed>|WP_Error */
	private function create_version( string $mount, string $path, string $absolute ) {
		$lock = $this->acquire_mutation_lock();
		if ( is_wp_error( $lock ) ) { return $lock; }
		if ( ! is_file( $absolute ) || is_link( $absolute ) ) {
			return array();
		}
		$storage = $this->require_private_storage();
		if ( is_wp_error( $storage ) ) {
			return $storage;
		}
		$uuid      = wp_generate_uuid4();
		$asset_key = $this->database->asset_key( 'local', $mount, $path );
		$relative  = $asset_key . '/' . $uuid . '.bin';
		$dest      = $this->system_root . '/versions/' . $relative;
		$size      = max( 0, (int) @filesize( $absolute ) );
		$capacity  = $this->ensure_capacity( $size, $dest, $size );
		if ( is_wp_error( $capacity ) ) {
			return $capacity;
		}
		wp_mkdir_p( dirname( $dest ) );
		if ( ! @copy( $absolute, $dest ) || @filesize( $dest ) !== @filesize( $absolute ) ) {
			@unlink( $dest );
			return new WP_Error( 'kodety_fs_version_failed', __( 'A safety version could not be created.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		$checksum = (string) @hash_file( 'sha256', $absolute );
		if ( '' === $checksum || ! hash_equals( $checksum, (string) @hash_file( 'sha256', $dest ) ) ) {
			@unlink( $dest );
			return new WP_Error( 'kodety_fs_version_failed', __( 'A safety version could not be verified.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		@chmod( $dest, 0640 );
		$row = array( 'id' => $uuid, 'asset_key' => $asset_key, 'provider' => 'local', 'mount' => $mount, 'path' => $path, 'storage_path' => $relative, 'size' => $size, 'checksum' => $checksum );
		if ( ! $this->database->add_version( $row ) ) {
			@unlink( $dest );
			return new WP_Error( 'kodety_fs_version_index', __( 'The safety version could not be indexed, so the mutation was cancelled.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		return $row;
	}

	/** @return true|WP_Error */
	private function require_private_storage() {
		return self::private_storage_available()
			? true
			: new WP_Error(
				'kodety_fs_private_storage_unavailable',
				__( 'This operation requires a writable private storage root outside the public document root.', 'kodety-file-system' ),
				array( 'status' => 503 )
			);
	}

	/** @return true|WP_Error */
	private function validate_destination_tree( string $source, string $mount, string $destination_path ) {
		if ( is_file( $source ) ) {
			$source_policy = $this->validate_code_mutation_target( $mount, wp_basename( $source ) );
			if ( is_wp_error( $source_policy ) ) {
				return $source_policy;
			}
			$sensitive = $this->validate_code_mutation_target( $mount, $destination_path );
			if ( is_wp_error( $sensitive ) || 'public' !== $mount ) {
				return $sensitive;
			}
			return $this->validate_public_asset( $destination_path, $this->detect_mime( $source, $destination_path ) );
		}
		if ( $this->guard->is_allowed_environment_name( wp_basename( $destination_path ) ) ) {
			return new WP_Error( 'kodety_fs_invalid_name', __( 'Environment names are reserved for files and cannot be used as folders.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		$limit = min( 200000, max( 100, (int) apply_filters( 'kodety_fs_mutation_scan_limit', 20000 ) ) );
		$deadline = microtime( true ) + min( 30.0, max( 0.5, (float) apply_filters( 'kodety_fs_mutation_scan_deadline_seconds', 5.0 ) ) );
		$count = 0;
		try {
			$iterator = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $source, FilesystemIterator::SKIP_DOTS ) );
			foreach ( $iterator as $entry ) {
				if ( ++$count > $limit || microtime( true ) >= $deadline ) {
					return new WP_Error( 'kodety_fs_validation_limit', __( 'The folder exceeds its validation item or processing-time limit.', 'kodety-file-system' ), array( 'status' => 413 ) );
				}
				$relative = ltrim( substr( wp_normalize_path( $entry->getPathname() ), strlen( untrailingslashit( wp_normalize_path( $source ) ) ) ), '/' );
				$target_name = trailingslashit( $destination_path ) . $relative;
				$stat = @lstat( $entry->getPathname() );
				$unsafe_link = $entry->isLink() || ! is_array( $stat ) || ! $entry->isDir() && (int) ( $stat['nlink'] ?? 1 ) > 1;
				$policy = $entry->isDir() ? true : $this->validate_code_mutation_target( $mount, $entry->getFilename() );
				if ( ! is_wp_error( $policy ) && ! $entry->isDir() ) {
					$policy = $this->validate_code_mutation_target( $mount, $target_name );
				}
				if ( ! is_wp_error( $policy ) && 'public' === $mount && ! $entry->isDir() ) {
					$policy = $this->validate_public_asset( $target_name, $this->detect_mime( $entry->getPathname(), $target_name ) );
				}
				if ( $unsafe_link || is_wp_error( $policy ) ) {
					return new WP_Error( 'kodety_fs_public_content', __( 'This folder contains a link or a file type that cannot be copied to the destination mount safely.', 'kodety-file-system' ), array( 'status' => 400 ) );
				}
			}
		} catch ( UnexpectedValueException $exception ) {
			return new WP_Error( 'kodety_fs_validation_failed', $exception->getMessage(), array( 'status' => 500 ) );
		}
		return true;
	}

	private function apply_mount_permissions( string $path, string $mount ): void {
		if ( is_link( $path ) || ! file_exists( $path ) ) {
			return;
		}
		$is_public = 'public' === $mount;
		@chmod( $path, is_dir( $path ) ? ( $is_public ? 0755 : 0750 ) : ( $is_public ? 0644 : 0640 ) );
		if ( ! is_dir( $path ) ) {
			return;
		}
		foreach ( new FilesystemIterator( $path, FilesystemIterator::SKIP_DOTS ) as $entry ) {
			$this->apply_mount_permissions( $entry->getPathname(), $mount );
		}
	}

	/** @return true|WP_Error */
	private function move_tree( string $source, string $destination ) {
		if ( @rename( $source, $destination ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.rename_rename
			return true;
		}
		$copied = $this->copy_tree( $source, $destination );
		if ( is_wp_error( $copied ) ) {
			if ( file_exists( $destination ) && ! is_link( $destination ) ) { $this->remove_tree( $destination ); }
			return $copied;
		}
		$removed = $this->remove_tree( $source );
		if ( is_wp_error( $removed ) ) {
			$this->remove_tree( $destination );
			return $removed;
		}
		return true;
	}

	/** @return true|WP_Error */
	private function merge_staged_tree( string $source, string $destination ) {
		if ( ! is_dir( $destination ) && ! wp_mkdir_p( $destination ) ) {
			return new WP_Error( 'kodety_fs_zip_commit', __( 'The extraction destination could not be created.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		foreach ( new FilesystemIterator( $source, FilesystemIterator::SKIP_DOTS ) as $entry ) {
			$target = $destination . '/' . $entry->getFilename();
			if ( $entry->isDir() && is_dir( $target ) ) {
				$result = $this->merge_staged_tree( $entry->getPathname(), $target );
			} elseif ( file_exists( $target ) ) {
				$result = new WP_Error( 'kodety_fs_zip_conflict', __( 'The ZIP would overwrite an existing item.', 'kodety-file-system' ), array( 'status' => 409 ) );
			} else {
				$result = $this->move_tree( $entry->getPathname(), $target );
			}
			if ( is_wp_error( $result ) ) {
				return $result;
			}
		}
		return @rmdir( $source ) ? true : new WP_Error( 'kodety_fs_zip_commit', __( 'The extraction staging folder could not be finalized.', 'kodety-file-system' ), array( 'status' => 500 ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir
	}

	/** @return true|WP_Error */
	private function copy_tree( string $source, string $destination ) {
		if ( is_link( $source ) ) {
			return new WP_Error( 'kodety_fs_symlink', __( 'Symbolic links cannot be copied.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		if ( is_file( $source ) ) {
			wp_mkdir_p( dirname( $destination ) );
			return @copy( $source, $destination ) ? true : new WP_Error( 'kodety_fs_copy_failed', __( 'The file could not be copied.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		if ( ! wp_mkdir_p( $destination ) ) {
			return new WP_Error( 'kodety_fs_copy_failed', __( 'The destination folder could not be created.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		foreach ( new FilesystemIterator( $source, FilesystemIterator::SKIP_DOTS ) as $entry ) {
			$result = $this->copy_tree( $entry->getPathname(), $destination . '/' . $entry->getFilename() );
			if ( is_wp_error( $result ) ) {
				return $result;
			}
		}
		return true;
	}

	/** @return true|WP_Error */
	private function remove_tree( string $path ) {
		if ( is_link( $path ) ) {
			return new WP_Error( 'kodety_fs_symlink', __( 'Symbolic links cannot be deleted through this API.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		if ( is_file( $path ) ) {
			return @unlink( $path ) ? true : new WP_Error( 'kodety_fs_delete_failed', __( 'The file could not be deleted.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		foreach ( new FilesystemIterator( $path, FilesystemIterator::SKIP_DOTS ) as $entry ) {
			$result = $this->remove_tree( $entry->getPathname() );
			if ( is_wp_error( $result ) ) {
				return $result;
			}
		}
		return @rmdir( $path ) ? true : new WP_Error( 'kodety_fs_delete_failed', __( 'The folder could not be deleted.', 'kodety-file-system' ), array( 'status' => 500 ) );
	}
}
