<?php

defined( 'ABSPATH' ) || exit;

final class Kodety_FS_Path_Guard {
	private const WINDOWS_RESERVED_NAMES = array(
		'con', 'prn', 'aux', 'nul',
		'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
		'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
	);
	private const EXECUTABLE_EXTENSIONS = array(
		'php', 'php3', 'php4', 'php5', 'php7', 'php8', 'phtml', 'phar', 'cgi', 'pl',
		'py', 'rb', 'sh', 'bash', 'zsh', 'fish', 'exe', 'dll', 'com', 'bat', 'cmd',
		'ps1', 'msi', 'jar', 'jsp', 'asp', 'aspx', 'asa', 'asax', 'ashx', 'asmx',
		'axd', 'svc', 'cshtml', 'vbhtml', 'htaccess', 'user.ini',
	);
	private const FORBIDDEN_SERVER_NAMES = array(
		'web.config', 'global.asa', 'global.asax', 'applicationhost.config',
		'machine.config', 'app.config',
	);

	private const DANGEROUS_EDIT_EXTENSIONS = array(
		'php', 'php3', 'php4', 'php5', 'php7', 'php8', 'phtml', 'phar', 'env',
		'ini', 'htaccess', 'user.ini', 'sh', 'bash', 'zsh', 'ps1', 'cgi', 'pl', 'py', 'rb',
	);

	private const ACTIVE_PUBLIC_EXTENSIONS = array(
		'html', 'htm', 'xht', 'xhtm', 'xhtml', 'shtm', 'shtml', 'mht', 'mhtml',
		'svg', 'svgz', 'js', 'mjs', 'cjs', 'jsx', 'xml', 'xsl', 'xslt', 'swf',
	);

	/** @return string|WP_Error */
	public function normalize_relative( $path, bool $allow_empty = true ) {
		if ( ! is_string( $path ) ) {
			return new WP_Error( 'kodety_fs_invalid_path', __( 'The path must be text.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}

		$decoded = $path;
		for ( $i = 0; $i < 4; $i++ ) {
			$next = rawurldecode( $decoded );
			if ( $next === $decoded ) {
				break;
			}
			$decoded = $next;
		}

		if ( preg_match( '/[\x00-\x1F\x7F]/', $decoded ) ) {
			return new WP_Error( 'kodety_fs_invalid_path', __( 'Control characters are not allowed in paths.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		if ( str_contains( $decoded, '\\' ) || str_starts_with( $decoded, '/' ) || preg_match( '/^[a-zA-Z]:/', $decoded ) || preg_match( '#^[a-z][a-z0-9+.-]*://#i', $decoded ) ) {
			return new WP_Error( 'kodety_fs_absolute_path', __( 'Absolute and Windows paths are not allowed.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}

		$decoded = trim( $decoded, '/' );
		if ( '' === $decoded ) {
			return $allow_empty ? '' : new WP_Error( 'kodety_fs_empty_path', __( 'A path is required.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}

		$segments = explode( '/', $decoded );
		$clean    = array();
		$last_segment = count( $segments ) - 1;
		foreach ( $segments as $index => $segment ) {
			if ( '' === $segment || '.' === $segment || '..' === $segment ) {
				return new WP_Error( 'kodety_fs_path_traversal', __( 'Path traversal is not allowed.', 'kodety-file-system' ), array( 'status' => 403 ) );
			}
			$allowed_environment_file = $index === $last_segment && $this->is_allowed_environment_name( $segment );
			if ( ( str_starts_with( $segment, '.' ) && ! $allowed_environment_file ) || str_contains( $segment, ':' ) || strlen( $segment ) > 255 || preg_match( '/[. ]$/', $segment ) || $this->is_windows_reserved_name( $segment ) || $this->is_forbidden_server_name( $segment ) ) {
				return new WP_Error( 'kodety_fs_invalid_segment', __( 'The path contains a forbidden segment.', 'kodety-file-system' ), array( 'status' => 400 ) );
			}
			$clean[] = $segment;
		}
		return implode( '/', $clean );
	}

	/** @return string|WP_Error */
	public function sanitize_name( $name ) {
		if ( ! is_string( $name ) || '' === trim( $name ) ) {
			return new WP_Error( 'kodety_fs_invalid_name', __( 'A file name is required.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		$decoded = $name;
		for ( $i = 0; $i < 4; $i++ ) {
			$next = rawurldecode( $decoded );
			if ( $next === $decoded ) {
				break;
			}
			$decoded = $next;
		}
		if ( '.' === $decoded || '..' === $decoded || ( str_starts_with( $decoded, '.' ) && ! $this->is_allowed_environment_name( $decoded ) ) || preg_match( '~[\\\\/\x00-\x1F\x7F:]~', $decoded ) || preg_match( '/[. ]$/', $decoded ) || strlen( $decoded ) > 255 || $this->is_windows_reserved_name( $decoded ) || $this->is_forbidden_server_name( $decoded ) ) {
			return new WP_Error( 'kodety_fs_invalid_name', __( 'The file name is not allowed.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		$sanitized = sanitize_file_name( $decoded );
		if ( '' === $sanitized || strlen( $sanitized ) > 255 || preg_match( '/[. ]$/', $sanitized ) || $this->is_windows_reserved_name( $sanitized ) || $this->is_forbidden_server_name( $sanitized ) ) {
			return new WP_Error( 'kodety_fs_invalid_name', __( 'The file name is not allowed.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		return $sanitized;
	}

	private function is_windows_reserved_name( string $name ): bool {
		$base = strtolower( explode( '.', rtrim( $name, '. ' ), 2 )[0] );
		return in_array( $base, self::WINDOWS_RESERVED_NAMES, true );
	}

	public function is_forbidden_server_name( string $name ): bool {
		return in_array( strtolower( trim( $name ) ), self::FORBIDDEN_SERVER_NAMES, true );
	}

	/** @return string|WP_Error */
	public function resolve( string $root, $relative, bool $must_exist = false ) {
		$relative = $this->normalize_relative( $relative, true );
		if ( is_wp_error( $relative ) ) {
			return $relative;
		}

		$root_real = realpath( $root );
		if ( false === $root_real || ! is_dir( $root_real ) || is_link( $root ) ) {
			return new WP_Error( 'kodety_fs_invalid_root', __( 'The storage root is unavailable.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		$root_real = untrailingslashit( wp_normalize_path( $root_real ) );
		$target    = $root_real . ( '' === $relative ? '' : '/' . $relative );

		$current = $root_real;
		if ( '' !== $relative ) {
			foreach ( explode( '/', $relative ) as $segment ) {
				$current .= '/' . $segment;
				if ( is_link( $current ) ) {
					return new WP_Error( 'kodety_fs_symlink', __( 'Symbolic links are not allowed.', 'kodety-file-system' ), array( 'status' => 403 ) );
				}
				if ( file_exists( $current ) ) {
					$stat = @lstat( $current );
					if ( is_array( $stat ) && is_file( $current ) && (int) ( $stat['nlink'] ?? 1 ) > 1 ) {
						return new WP_Error( 'kodety_fs_hardlink', __( 'Hard-linked files are not allowed in managed storage.', 'kodety-file-system' ), array( 'status' => 403 ) );
					}
					$real = realpath( $current );
					if ( false === $real || ! $this->is_within( $root_real, wp_normalize_path( $real ) ) ) {
						return new WP_Error( 'kodety_fs_outside_root', __( 'The requested path is outside its storage mount.', 'kodety-file-system' ), array( 'status' => 403 ) );
					}
				}
			}
		}

		if ( $must_exist && ! file_exists( $target ) ) {
			return new WP_Error( 'kodety_fs_not_found', __( 'The requested file was not found.', 'kodety-file-system' ), array( 'status' => 404 ) );
		}
		return $target;
	}

	public function is_within( string $root, string $path ): bool {
		$root = untrailingslashit( wp_normalize_path( $root ) );
		$path = wp_normalize_path( $path );
		return $path === $root || str_starts_with( $path, $root . '/' );
	}

	public function is_executable_public_name( string $name ): bool {
		$lower = strtolower( wp_basename( $name ) );
		if ( $this->is_forbidden_server_name( wp_basename( $lower ) ) ) {
			return true;
		}
		$segments = explode( '.', $lower );
		array_shift( $segments );
		foreach ( $segments as $segment ) {
			if ( in_array( $segment, self::EXECUTABLE_EXTENSIONS, true ) ) {
				return true;
			}
		}
		foreach ( self::EXECUTABLE_EXTENSIONS as $extension ) {
			if ( str_ends_with( $lower, '.' . $extension ) || $lower === $extension || str_ends_with( $lower, $extension ) && str_starts_with( $extension, '.' ) ) {
				return true;
			}
		}
		return (bool) preg_match( '/\.(?:php\d*|phtml|phar)(?:\.|$)/i', $lower );
	}

	public function is_dangerous_edit_name( string $name ): bool {
		$lower = strtolower( $name );
		if ( $this->is_allowed_environment_name( $lower ) ) {
			return true;
		}
		foreach ( self::DANGEROUS_EDIT_EXTENSIONS as $extension ) {
			if ( str_ends_with( $lower, '.' . ltrim( $extension, '.' ) ) || $lower === $extension ) {
				return true;
			}
		}
		return false;
	}

	public function is_allowed_environment_name( string $name ): bool {
		return (bool) preg_match( '/^\.env(?:\.[a-z0-9][a-z0-9_-]{0,63})?$/i', $name );
	}

	public function is_active_public_name( string $name ): bool {
		$segments = explode( '.', strtolower( wp_basename( $name ) ) );
		array_shift( $segments );
		return ! empty( array_intersect( $segments, self::ACTIVE_PUBLIC_EXTENSIONS ) );
	}

	/** @return string|WP_Error */
	public function sanitize_svg( string $svg ) {
		if ( strlen( $svg ) > 10 * MB_IN_BYTES ) {
			return new WP_Error( 'kodety_fs_svg_too_large', __( 'The SVG is too large.', 'kodety-file-system' ), array( 'status' => 413 ) );
		}
		if ( ! preg_match( '/<svg\b/i', $svg ) || preg_match( '/<(?:script|foreignObject|iframe|object|embed|audio|video)\b/i', $svg ) || preg_match( '/\son[a-z]+\s*=/i', $svg ) || preg_match( '/(?:javascript|vbscript)\s*:/i', $svg ) || preg_match( '/(?:href|src)\s*=\s*["\']\s*(?:https?:|\/\/|data:text\/html)/i', $svg ) || preg_match( '/url\s*\(\s*["\']?\s*(?:https?:|\/\/|javascript:)/i', $svg ) ) {
			return new WP_Error( 'kodety_fs_unsafe_svg', __( 'The SVG contains unsafe active or external content.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		$svg = preg_replace( '/<\?xml-stylesheet\b[^?]*\?>/i', '', $svg );
		$svg = preg_replace( '/<!DOCTYPE[^>]*(?:\[[\s\S]*?\]\s*)?>/i', '', (string) $svg );
		return (string) $svg;
	}
}
