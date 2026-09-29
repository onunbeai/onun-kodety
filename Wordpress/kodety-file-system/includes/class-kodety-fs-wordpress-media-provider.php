<?php

defined( 'ABSPATH' ) || exit;

final class Kodety_FS_WordPress_Media_Provider implements Kodety_FS_Storage_Provider {
	public function get_id(): string {
		return 'wordpress-media';
	}

	public function get_label(): string {
		return __( 'WordPress Media', 'kodety-file-system' );
	}

	public function get_capabilities(): array {
		return array( 'list' => true, 'read' => true, 'write' => false, 'upload' => true, 'delete' => self::trash_available(), 'move' => false, 'copy' => false, 'versions' => false, 'visibility' => false, 'archives' => false );
	}

	/** WordPress otherwise turns a normal attachment delete into a permanent purge. */
	public static function trash_available(): bool {
		return defined( 'MEDIA_TRASH' ) && true === MEDIA_TRASH
			&& defined( 'EMPTY_TRASH_DAYS' ) && (int) EMPTY_TRASH_DAYS > 0;
	}

	public function list( array $args ) {
		$page     = max( 1, (int) ( $args['page'] ?? 1 ) );
		$per_page = min( 100, max( 1, (int) ( $args['per_page'] ?? 50 ) ) );
		$query     = new WP_Query(
			array(
				'post_type'      => 'attachment',
					'post_status'    => 'inherit',
					'perm'           => 'readable',
				'posts_per_page' => $per_page,
				'paged'          => $page,
				's'              => sanitize_text_field( (string) ( $args['query'] ?? '' ) ),
				'orderby'        => 'modified',
				'order'          => 'DESC',
			)
		);
		$items = array();
		foreach ( $query->posts as $attachment ) {
			$item = $this->item( (int) $attachment->ID );
			if ( ! is_wp_error( $item ) ) {
				$items[] = $item;
			}
		}
		return array( 'items' => $items, 'total' => (int) $query->found_posts, 'page' => $page, 'perPage' => $per_page, 'mount' => 'media', 'path' => '' );
	}

	public function stat( array $args ) {
		$id = $this->id_from_args( $args );
		return $id > 0 ? $this->item( $id ) : new WP_Error( 'kodety_fs_media_id', __( 'A WordPress media ID is required.', 'kodety-file-system' ), array( 'status' => 400 ) );
	}

	public function read( array $args ) {
		$id   = $this->id_from_args( $args );
		if ( ! $id || ! current_user_can( 'read_post', $id ) ) {
			return new WP_Error( 'kodety_fs_media_read_forbidden', __( 'You cannot read this WordPress media item.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		$file = $id ? get_attached_file( $id ) : false;
		if ( ! is_string( $file ) || ! is_file( $file ) || is_link( $file ) ) {
			return new WP_Error( 'kodety_fs_media_missing', __( 'The media file was not found.', 'kodety-file-system' ), array( 'status' => 404 ) );
		}
		$uploads = wp_upload_dir();
		$guard   = new Kodety_FS_Path_Guard();
		if ( ! $guard->is_within( wp_normalize_path( $uploads['basedir'] ), wp_normalize_path( realpath( $file ) ?: $file ) ) ) {
			return new WP_Error( 'kodety_fs_media_outside_uploads', __( 'The media file is outside the WordPress uploads directory.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		$content = file_get_contents( $file ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		return false === $content ? new WP_Error( 'kodety_fs_media_read', __( 'The media file could not be read.', 'kodety-file-system' ), array( 'status' => 500 ) ) : $content;
	}

	public function write( array $args ) {
		return new WP_Error( 'kodety_fs_provider_unsupported', __( 'WordPress media files are replaced through the upload workflow.', 'kodety-file-system' ), array( 'status' => 501 ) );
	}

	public function upload( array $file, array $args ) {
		if ( ! current_user_can( 'upload_files' ) ) {
			return new WP_Error( 'kodety_fs_media_permission', __( 'You cannot upload WordPress media.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		$name = (string) ( $file['name'] ?? '' );
		$temp = (string) ( $file['tmp_name'] ?? '' );
		$guard = new Kodety_FS_Path_Guard();
		$safe_name = $guard->sanitize_name( $name );
		if ( is_wp_error( $safe_name ) || $guard->is_executable_public_name( $name ) || $guard->is_active_public_name( $name ) ) {
			return new WP_Error( 'kodety_fs_media_active_content', __( 'Executable or active document formats cannot be uploaded to the same-origin WordPress Media Library through Onun Kodety.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		$mime = '';
		if ( is_file( $temp ) && ! is_link( $temp ) && function_exists( 'finfo_open' ) ) {
			$finfo = finfo_open( FILEINFO_MIME_TYPE );
			$detected = $finfo ? finfo_file( $finfo, $temp ) : false;
			if ( $finfo ) { finfo_close( $finfo ); }
			$mime = is_string( $detected ) ? $detected : '';
		}
		if ( preg_match( '~(?:php|x-httpd|x-executable|x-sharedlib|x-shellscript|x-msdownload|x-asp|text/html|application/xhtml\+xml|image/svg\+xml|javascript|ecmascript)~i', $mime ) ) {
			return new WP_Error( 'kodety_fs_media_active_content', __( 'The uploaded bytes are an executable or active document and cannot enter the WordPress Media Library through Onun Kodety.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		$file['name'] = $safe_name;
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';
		$id = media_handle_sideload( $file, 0, sanitize_text_field( (string) ( $args['title'] ?? '' ) ) );
		return is_wp_error( $id ) ? $id : $this->item( (int) $id );
	}

	public function delete( array $args ) {
		$id = $this->id_from_args( $args );
		if ( ! $id || ! current_user_can( 'delete_post', $id ) ) {
			return new WP_Error( 'kodety_fs_media_delete', __( 'This media item cannot be deleted.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		if ( ! self::trash_available() ) {
			return new WP_Error(
				'kodety_fs_media_trash_unavailable',
				__( 'WordPress Media Trash is disabled. Onun Kodety will not permanently delete this attachment through a normal delete action.', 'kodety-file-system' ),
				array( 'status' => 409 )
			);
		}
		// WordPress permanently deletes an attachment when wp_delete_attachment()
		// is called for an item that is already in Trash. Keep the normal Onun Kodety
		// delete operation idempotent so it can never become an implicit purge.
		if ( 'trash' === get_post_status( $id ) ) {
			return array( 'id' => 'wp-media:' . $id, 'trashed' => true, 'deleted' => false );
		}
		$result = wp_delete_attachment( $id, false );
		return $result && 'trash' === get_post_status( $id )
			? array( 'id' => 'wp-media:' . $id, 'trashed' => true, 'deleted' => false )
			: new WP_Error( 'kodety_fs_media_delete_failed', __( 'The media item could not be moved to the WordPress trash.', 'kodety-file-system' ), array( 'status' => 500 ) );
	}

	public function get_url( array $args ) {
		$id  = $this->id_from_args( $args );
		if ( ! $id || ! current_user_can( 'read_post', $id ) ) {
			return new WP_Error( 'kodety_fs_media_read_forbidden', __( 'You cannot read this WordPress media item.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		$url = $id ? wp_get_attachment_url( $id ) : false;
		return $url ? array( 'url' => $url, 'previewUrl' => $url ) : new WP_Error( 'kodety_fs_media_url', __( 'The media URL is unavailable.', 'kodety-file-system' ), array( 'status' => 404 ) );
	}

	/** @return string|WP_Error */
	public function attached_path( int $id ) {
		if ( $id < 1 || ! current_user_can( 'read_post', $id ) ) {
			return new WP_Error( 'kodety_fs_media_read_forbidden', __( 'You cannot read this WordPress media item.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		$file = get_attached_file( $id );
		if ( ! is_string( $file ) || ! is_file( $file ) || is_link( $file ) ) {
			return new WP_Error( 'kodety_fs_media_missing', __( 'The media file was not found.', 'kodety-file-system' ), array( 'status' => 404 ) );
		}
		$uploads = wp_upload_dir();
		$root = realpath( (string) $uploads['basedir'] );
		$resolved = realpath( $file );
		$guard = new Kodety_FS_Path_Guard();
		if ( false === $root || false === $resolved || ! $guard->is_within( wp_normalize_path( $root ), wp_normalize_path( $resolved ) ) ) {
			return new WP_Error( 'kodety_fs_media_outside_uploads', __( 'The media file is outside the WordPress uploads directory.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		return $resolved;
	}

	private function id_from_args( array $args ): int {
		$value = $args['id'] ?? $args['path'] ?? 0;
		if ( is_string( $value ) && str_starts_with( $value, 'wp-media:' ) ) {
			$value = substr( $value, 9 );
		}
		return absint( $value );
	}

	/** @return array<string,mixed>|WP_Error */
	private function item( int $id ) {
		$post = get_post( $id );
		if ( ! $post || 'attachment' !== $post->post_type ) {
			return new WP_Error( 'kodety_fs_media_not_found', __( 'The media item was not found.', 'kodety-file-system' ), array( 'status' => 404 ) );
		}
		if ( ! current_user_can( 'read_post', $id ) ) {
			return new WP_Error( 'kodety_fs_media_read_forbidden', __( 'You cannot read this WordPress media item.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		$file = get_attached_file( $id );
		$url  = wp_get_attachment_url( $id );
		$meta = wp_get_attachment_metadata( $id );
		return array(
			'id'          => 'wp-media:' . $id,
			'wordpressId' => $id,
			'name'        => $file ? wp_basename( $file ) : sanitize_file_name( $post->post_title ),
			'path'        => (string) $id,
			'kind'        => 'file',
			'mimeType'    => (string) get_post_mime_type( $id ),
			'size'        => $file && is_file( $file ) ? (int) filesize( $file ) : 0,
			'mount'       => 'media',
			'provider'    => 'wordpress-media',
			'visibility'  => 'public',
			'publicUrl'   => $url ?: null,
			'previewUrl'  => $url ?: null,
			'updatedAt'   => mysql_to_rfc3339( $post->post_modified_gmt ),
			'favorite'    => false,
			'tags'        => array(),
			'width'       => is_array( $meta ) && isset( $meta['width'] ) ? (int) $meta['width'] : null,
			'height'      => is_array( $meta ) && isset( $meta['height'] ) ? (int) $meta['height'] : null,
				'permissions' => array( 'read' => true, 'write' => false, 'upload' => current_user_can( 'upload_files' ), 'delete' => self::trash_available() && current_user_can( 'delete_post', $id ) ),
		);
	}
}
