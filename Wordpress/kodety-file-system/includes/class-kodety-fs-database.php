<?php

defined( 'ABSPATH' ) || exit;

final class Kodety_FS_Database {
	private wpdb $wpdb;
	private string $prefix;

	public function __construct() {
		global $wpdb;
		$this->wpdb   = $wpdb;
		$this->prefix = $wpdb->prefix . 'kodety_fs_';
	}

	public static function install(): void {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$prefix  = $wpdb->prefix . 'kodety_fs_';
		$charset = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$prefix}assets (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			asset_key char(64) NOT NULL,
			provider varchar(40) NOT NULL,
			mount_id varchar(80) NOT NULL,
			path_hash char(64) NOT NULL,
			path text NOT NULL,
			filename varchar(255) NOT NULL,
			kind varchar(20) NOT NULL DEFAULT 'file',
			mime_type varchar(190) NOT NULL DEFAULT '',
			size bigint(20) unsigned NOT NULL DEFAULT 0,
			checksum char(64) NOT NULL DEFAULT '',
			visibility varchar(20) NOT NULL DEFAULT 'private',
			width int(10) unsigned NULL,
			height int(10) unsigned NULL,
			created_by bigint(20) unsigned NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			deleted_at datetime NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY asset_key (asset_key),
			KEY location (provider,mount_id,path_hash),
			KEY updated_at (updated_at)
		) {$charset};

		CREATE TABLE {$prefix}versions (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			version_uuid char(36) NOT NULL,
			asset_key char(64) NOT NULL,
			provider varchar(40) NOT NULL,
			mount_id varchar(80) NOT NULL,
			path text NOT NULL,
			storage_path text NOT NULL,
			size bigint(20) unsigned NOT NULL DEFAULT 0,
			checksum char(64) NOT NULL DEFAULT '',
			created_by bigint(20) unsigned NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY version_uuid (version_uuid),
			KEY asset_key (asset_key),
			KEY created_at (created_at)
		) {$charset};

		CREATE TABLE {$prefix}activity (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			user_id bigint(20) unsigned NOT NULL DEFAULT 0,
			action varchar(80) NOT NULL,
			provider varchar(40) NOT NULL DEFAULT 'local',
			mount_id varchar(80) NOT NULL DEFAULT '',
			path text NOT NULL,
			before_json longtext NULL,
			after_json longtext NULL,
			ip_hash char(64) NOT NULL DEFAULT '',
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY user_id (user_id),
			KEY created_at (created_at),
			KEY action (action)
		) {$charset};

		CREATE TABLE {$prefix}metadata (
			asset_key char(64) NOT NULL,
			favorite tinyint(1) NOT NULL DEFAULT 0,
			tags_json longtext NULL,
			updated_by bigint(20) unsigned NOT NULL DEFAULT 0,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (asset_key),
			KEY favorite (favorite)
		) {$charset};

		CREATE TABLE {$prefix}trash (
			trash_uuid char(36) NOT NULL,
			provider varchar(40) NOT NULL DEFAULT 'local',
			original_mount varchar(80) NOT NULL,
			original_path text NOT NULL,
			trash_relpath text NOT NULL,
			is_dir tinyint(1) NOT NULL DEFAULT 0,
			deleted_by bigint(20) unsigned NOT NULL DEFAULT 0,
			deleted_at datetime NOT NULL,
			PRIMARY KEY  (trash_uuid),
			KEY deleted_at (deleted_at)
		) {$charset};

		CREATE TABLE {$prefix}shares (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			asset_key char(64) NOT NULL,
			token_hash char(64) NOT NULL,
			expires_at datetime NULL,
			max_downloads int(10) unsigned NULL,
			downloads int(10) unsigned NOT NULL DEFAULT 0,
			created_by bigint(20) unsigned NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY token_hash (token_hash),
			KEY asset_key (asset_key)
		) {$charset};

		CREATE TABLE {$prefix}usages (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			asset_key char(64) NOT NULL,
			object_type varchar(80) NOT NULL,
			object_id varchar(190) NOT NULL,
			context varchar(190) NOT NULL DEFAULT '',
			updated_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY asset_key (asset_key),
			KEY object_ref (object_type,object_id)
		) {$charset};";

		dbDelta( $sql );
		update_option( 'kodety_fs_db_version', KODETY_FS_VERSION, false );
	}

	public function asset_key( string $provider, string $mount, string $path ): string {
		return hash( 'sha256', $provider . "\n" . $mount . "\n" . $path );
	}

	/**
	 * Resolve an opaque local asset identifier back to its authoritative
	 * provider/mount/path tuple. Callers must never accept a client-supplied path
	 * alongside an ID without hydrating it through this lookup first.
	 */
	public function asset_by_key( string $asset_key ): ?array {
		if ( ! preg_match( '/^[a-f0-9]{64}$/', $asset_key ) ) {
			return null;
		}

		$row = $this->wpdb->get_row(
			$this->wpdb->prepare(
				"SELECT asset_key,provider,mount_id,path,filename,kind,mime_type,size,checksum,visibility,width,height,created_by,created_at,updated_at,deleted_at FROM {$this->prefix}assets WHERE asset_key=%s LIMIT 1",
				$asset_key
			),
			ARRAY_A
		);
		if ( ! $row ) {
			return null;
		}

		return array(
			'id'         => $row['asset_key'],
			'provider'   => $row['provider'],
			'mount'      => $row['mount_id'],
			'path'       => $row['path'],
			'name'       => $row['filename'],
			'kind'       => $row['kind'],
			'mimeType'   => $row['mime_type'],
			'size'       => (int) $row['size'],
			'checksum'   => $row['checksum'],
			'visibility' => $row['visibility'],
			'width'      => null === $row['width'] ? null : (int) $row['width'],
			'height'     => null === $row['height'] ? null : (int) $row['height'],
			'createdBy'  => (int) $row['created_by'],
			'createdAt'  => mysql_to_rfc3339( $row['created_at'] ),
			'updatedAt'  => mysql_to_rfc3339( $row['updated_at'] ),
			'deletedAt'  => $row['deleted_at'] ? mysql_to_rfc3339( $row['deleted_at'] ) : null,
		);
	}

	/** @return array<int,array<string,mixed>> */
	public function favorite_assets( int $limit = 200 ): array {
		$rows = $this->wpdb->get_col(
			$this->wpdb->prepare(
				"SELECT asset_key FROM {$this->prefix}metadata WHERE favorite=1 ORDER BY updated_at DESC LIMIT %d",
				min( 500, max( 1, $limit ) )
			)
		);
		$items = array();
		foreach ( $rows as $asset_key ) {
			$item = $this->asset_by_key( (string) $asset_key );
			if ( $item ) {
				$items[] = $item;
			}
		}
		return $items;
	}

	public function upsert_asset( array $item ): void {
		$provider  = (string) ( $item['provider'] ?? 'local' );
		$mount     = (string) ( $item['mount'] ?? '' );
		$path      = (string) ( $item['path'] ?? '' );
		$asset_key = $this->asset_key( $provider, $mount, $path );
		$now       = current_time( 'mysql', true );
		$existing  = $this->wpdb->get_var( $this->wpdb->prepare( "SELECT created_at FROM {$this->prefix}assets WHERE asset_key = %s", $asset_key ) );
		$this->wpdb->replace(
			$this->prefix . 'assets',
			array(
				'asset_key'  => $asset_key,
				'provider'   => $provider,
				'mount_id'   => $mount,
				'path_hash'  => hash( 'sha256', $path ),
				'path'       => $path,
				'filename'   => (string) ( $item['name'] ?? wp_basename( $path ) ),
				'kind'       => (string) ( $item['kind'] ?? 'file' ),
				'mime_type'  => (string) ( $item['mimeType'] ?? '' ),
				'size'       => max( 0, (int) ( $item['size'] ?? 0 ) ),
				'checksum'   => (string) ( $item['checksum'] ?? '' ),
				'visibility' => (string) ( $item['visibility'] ?? 'private' ),
				'width'      => isset( $item['width'] ) ? (int) $item['width'] : null,
				'height'     => isset( $item['height'] ) ? (int) $item['height'] : null,
				'created_by' => get_current_user_id(),
				'created_at' => $existing ?: $now,
				'updated_at' => $now,
				'deleted_at' => null,
			),
			array( '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%s', '%d', '%d', '%d', '%s', '%s', '%s' )
		);
	}

	public function mark_missing_under( string $provider, string $mount, string $prefix_path, array $seen_keys ): void {
		$like = '' === $prefix_path ? '%' : $this->wpdb->esc_like( trailingslashit( $prefix_path ) ) . '%';
		$rows = $this->wpdb->get_col( $this->wpdb->prepare( "SELECT asset_key FROM {$this->prefix}assets WHERE provider=%s AND mount_id=%s AND path LIKE %s", $provider, $mount, $like ) );
		foreach ( $rows as $key ) {
			if ( ! isset( $seen_keys[ $key ] ) ) {
				$this->wpdb->delete( $this->prefix . 'assets', array( 'asset_key' => $key ), array( '%s' ) );
			}
		}
	}

	public function metadata( string $asset_key ): array {
		$row = $this->wpdb->get_row( $this->wpdb->prepare( "SELECT favorite,tags_json FROM {$this->prefix}metadata WHERE asset_key=%s", $asset_key ), ARRAY_A );
		if ( ! $row ) {
			return array( 'favorite' => false, 'tags' => array() );
		}
		$tags = json_decode( (string) $row['tags_json'], true );
		return array( 'favorite' => (bool) $row['favorite'], 'tags' => is_array( $tags ) ? array_values( $tags ) : array() );
	}

	public function set_metadata( string $asset_key, bool $favorite, array $tags ): array {
		$tags = array_values( array_unique( array_filter( array_map( static fn( $tag ) => sanitize_text_field( (string) $tag ), $tags ) ) ) );
		$tags = array_slice( $tags, 0, 50 );
		$this->wpdb->replace(
			$this->prefix . 'metadata',
			array(
				'asset_key' => $asset_key,
				'favorite'  => $favorite ? 1 : 0,
				'tags_json' => wp_json_encode( $tags ),
				'updated_by'=> get_current_user_id(),
				'updated_at'=> current_time( 'mysql', true ),
			),
			array( '%s', '%d', '%s', '%d', '%s' )
		);
		return array( 'favorite' => $favorite, 'tags' => $tags );
	}

	public function add_activity( string $action, string $provider, string $mount, string $path, $before = null, $after = null ): bool {
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		$result = $this->wpdb->insert(
			$this->prefix . 'activity',
			array(
				'user_id'     => get_current_user_id(),
				'action'      => sanitize_key( $action ),
				'provider'    => sanitize_key( $provider ),
				'mount_id'    => sanitize_key( $mount ),
				'path'        => $path,
				'before_json' => null === $before ? null : wp_json_encode( $before ),
				'after_json'  => null === $after ? null : wp_json_encode( $after ),
				'ip_hash'     => '' === $ip ? '' : hash_hmac( 'sha256', $ip, wp_salt( 'auth' ) ),
				'created_at'  => current_time( 'mysql', true ),
			),
			array( '%d', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s' )
		);
		if ( false === $result ) {
			update_option( 'kodety_fs_audit_degraded', array( 'at' => time(), 'error' => sanitize_text_field( (string) $this->wpdb->last_error ) ), false );
			return false;
		}
		delete_option( 'kodety_fs_audit_degraded' );
		return true;
	}

	public function activity( int $limit = 50, int $offset = 0 ): array {
		$limit = min( 200, max( 1, $limit ) );
		$rows  = $this->wpdb->get_results( $this->wpdb->prepare( "SELECT * FROM {$this->prefix}activity ORDER BY id DESC LIMIT %d OFFSET %d", $limit, max( 0, $offset ) ), ARRAY_A );
		$actors = array();
		foreach ( $rows as &$row ) {
			$user_id = (int) $row['user_id'];
			if ( $user_id > 0 && ! array_key_exists( $user_id, $actors ) ) {
				$user = get_userdata( $user_id );
				$actors[ $user_id ] = $user ? (string) $user->display_name : (string) $user_id;
			}
			$row['id']     = (int) $row['id'];
			$row['userId'] = $user_id;
			$row['actor']   = $user_id > 0 ? ( $actors[ $user_id ] ?? (string) $user_id ) : '';
			$row['assetName'] = wp_basename( (string) $row['path'] );
			$row['mount']  = $row['mount_id'];
			$row['before'] = $row['before_json'] ? json_decode( $row['before_json'], true ) : null;
			$row['after']  = $row['after_json'] ? json_decode( $row['after_json'], true ) : null;
			$row['createdAt'] = mysql_to_rfc3339( $row['created_at'] );
			unset( $row['user_id'], $row['mount_id'], $row['before_json'], $row['after_json'], $row['ip_hash'], $row['created_at'] );
		}
		return $rows;
	}

	public function recent( int $limit = 40 ): array {
		$rows = $this->wpdb->get_results( $this->wpdb->prepare( "SELECT provider,mount_id,path,action,created_at FROM {$this->prefix}activity WHERE path<>'' ORDER BY id DESC LIMIT %d", min( 200, max( 1, $limit * 3 ) ) ), ARRAY_A );
		$seen = array();
		$out  = array();
		foreach ( $rows as $row ) {
			$key = $row['provider'] . '|' . $row['mount_id'] . '|' . $row['path'];
			if ( isset( $seen[ $key ] ) ) {
				continue;
			}
			$seen[ $key ] = true;
			$out[] = array( 'provider' => $row['provider'], 'mount' => $row['mount_id'], 'path' => $row['path'], 'action' => $row['action'], 'updatedAt' => mysql_to_rfc3339( $row['created_at'] ) );
			if ( count( $out ) >= $limit ) {
				break;
			}
		}
		return $out;
	}

	public function add_version( array $row ): bool {
		$result = $this->wpdb->insert(
			$this->prefix . 'versions',
			array(
				'version_uuid' => $row['id'],
				'asset_key'    => $row['asset_key'],
				'provider'     => $row['provider'],
				'mount_id'     => $row['mount'],
				'path'         => $row['path'],
				'storage_path' => $row['storage_path'],
				'size'         => (int) $row['size'],
				'checksum'     => $row['checksum'],
				'created_by'   => get_current_user_id(),
				'created_at'   => current_time( 'mysql', true ),
			),
			array( '%s', '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%d', '%s' )
		);
		return false !== $result;
	}

	public function versions( string $asset_key, int $limit = 100 ): array {
		$rows = $this->wpdb->get_results( $this->wpdb->prepare( "SELECT version_uuid,size,checksum,created_by,created_at FROM {$this->prefix}versions WHERE asset_key=%s ORDER BY id DESC LIMIT %d", $asset_key, min( 200, max( 1, $limit ) ) ), ARRAY_A );
		$total = (int) $this->wpdb->get_var( $this->wpdb->prepare( "SELECT COUNT(*) FROM {$this->prefix}versions WHERE asset_key=%s", $asset_key ) );
		return array_map(
			static fn( $row, $index ) => array(
				'id'        => $row['version_uuid'],
				'version'   => $total - $index,
				'size'      => (int) $row['size'],
				'checksum'  => $row['checksum'],
				'createdBy' => (int) $row['created_by'],
				'createdAt' => mysql_to_rfc3339( $row['created_at'] ),
			),
			$rows,
			array_keys( $rows )
		);
	}

	public function version( string $uuid ): ?array {
		$row = $this->wpdb->get_row( $this->wpdb->prepare( "SELECT * FROM {$this->prefix}versions WHERE version_uuid=%s", $uuid ), ARRAY_A );
		return $row ?: null;
	}

	public function version_belongs_to( string $uuid, string $asset_key ): bool {
		if ( ! preg_match( '/^[a-f0-9-]{36}$/', $uuid ) || ! preg_match( '/^[a-f0-9]{64}$/', $asset_key ) ) {
			return false;
		}
		return (bool) $this->wpdb->get_var(
			$this->wpdb->prepare(
				"SELECT 1 FROM {$this->prefix}versions WHERE version_uuid=%s AND asset_key=%s LIMIT 1",
				$uuid,
				$asset_key
			)
		);
	}

	public function add_trash( array $row ): bool {
		$result = $this->wpdb->insert(
			$this->prefix . 'trash',
			array(
				'trash_uuid'     => $row['id'],
				'provider'       => $row['provider'],
				'original_mount' => $row['mount'],
				'original_path'  => $row['path'],
				'trash_relpath'  => $row['trash_relpath'],
				'is_dir'         => $row['is_dir'] ? 1 : 0,
				'deleted_by'     => get_current_user_id(),
				'deleted_at'     => current_time( 'mysql', true ),
			),
			array( '%s', '%s', '%s', '%s', '%s', '%d', '%d', '%s' )
		);
		return false !== $result;
	}

	public function trash_item( string $uuid ): ?array {
		$row = $this->wpdb->get_row( $this->wpdb->prepare( "SELECT * FROM {$this->prefix}trash WHERE trash_uuid=%s", $uuid ), ARRAY_A );
		return $row ?: null;
	}

	public function trash_items( int $limit = 100 ): array {
		$rows = $this->wpdb->get_results( $this->wpdb->prepare( "SELECT * FROM {$this->prefix}trash ORDER BY deleted_at DESC LIMIT %d", min( 500, max( 1, $limit ) ) ), ARRAY_A );
		return array_map(
			static fn( $row ) => array(
				'id'        => $row['trash_uuid'],
				'provider'  => $row['provider'],
				'mount'     => $row['original_mount'],
				'path'      => $row['original_path'],
				'name'      => wp_basename( $row['original_path'] ),
				'kind'      => $row['is_dir'] ? 'folder' : 'file',
				'deletedBy' => (int) $row['deleted_by'],
				'deletedAt' => mysql_to_rfc3339( $row['deleted_at'] ),
			),
			$rows
		);
	}

	public function remove_trash( string $uuid ): bool {
		return false !== $this->wpdb->delete( $this->prefix . 'trash', array( 'trash_uuid' => $uuid ), array( '%s' ) );
	}

	public static function drop_all(): void {
		global $wpdb;
		foreach ( array( 'assets', 'versions', 'activity', 'metadata', 'trash', 'shares', 'usages' ) as $table ) {
			$wpdb->query( "DROP TABLE IF EXISTS {$wpdb->prefix}kodety_fs_{$table}" ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		}
	}
}
