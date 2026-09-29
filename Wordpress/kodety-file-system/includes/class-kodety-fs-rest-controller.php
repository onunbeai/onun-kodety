<?php

defined( 'ABSPATH' ) || exit;

final class Kodety_FS_REST_Controller {
	private Kodety_FS_Database $database;
	private Kodety_FS_Path_Guard $guard;
	private Kodety_FS_Local_Provider $local;
	private Kodety_FS_WordPress_Media_Provider $media;
	private Kodety_FS_Remote_Provider $remote;

	public function __construct( Kodety_FS_Database $database, Kodety_FS_Path_Guard $guard, Kodety_FS_Local_Provider $local, Kodety_FS_WordPress_Media_Provider $media, Kodety_FS_Remote_Provider $remote ) {
		$this->database = $database;
		$this->guard    = $guard;
		$this->local    = $local;
		$this->media    = $media;
		$this->remote   = $remote;
	}

	public function register_routes(): void {
		$this->route( '/bootstrap', 'GET', 'bootstrap', 'read' );
		$this->route( '/files', 'GET', 'files', 'read' );
		$this->route( '/files', 'POST', 'create_file', 'edit' );
		$this->route( '/files', 'DELETE', 'delete_file', 'delete' );
		$this->route( '/upload', 'POST', 'upload', 'upload' );
		$this->route( '/operations', 'POST', 'operation', 'edit' );
		$this->route( '/content', 'GET', 'content', 'read' );
		$this->route( '/content', 'PUT', 'update_content', 'edit_code' );
		$this->route( '/versions', 'GET', 'versions', 'read' );
		$this->route( '/versions/restore', 'POST', 'restore_version', 'edit' );
		$this->route( '/download', 'GET', 'download', 'read' );
		$this->route( '/preview', 'GET', 'preview', 'read' );
		$this->route( '/metadata', 'POST', 'metadata', 'edit' );
		$this->route( '/activity', 'GET', 'activity', 'view_audit' );
		$this->route( '/recent', 'GET', 'recent', 'read' );
		$this->route( '/rescan', 'POST', 'rescan', 'manage_storage' );
		$this->route( '/settings', 'GET', 'settings', 'manage_storage' );
		$this->route( '/settings', 'PUT', 'update_settings', 'manage_storage' );
		$this->route( '/settings/test-remote', 'POST', 'test_remote', 'manage_storage' );
		$this->route( '/trash', 'GET', 'trash', 'read' );
		$this->route( '/trash/restore', 'POST', 'restore_trash', 'edit' );
		$this->route( '/trash/permanent', 'DELETE', 'delete_trash', 'purge' );
		$this->route( '/wordpress-media/import', 'POST', 'import_media', 'upload' );
		$this->route( '/uploads/init', 'POST', 'upload_init', 'upload' );

		register_rest_route(
			KODETY_FS_REST_NAMESPACE,
			'/uploads/(?P<id>[a-f0-9-]{36})/chunk',
			array(
				'methods'             => array( 'PUT', 'POST' ),
				'callback'            => array( $this, 'upload_chunk' ),
				'permission_callback' => array( $this, 'permission_upload' ),
			)
		);
		register_rest_route(
			KODETY_FS_REST_NAMESPACE,
			'/uploads/(?P<id>[a-f0-9-]{36})/complete',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'upload_complete' ),
				'permission_callback' => array( $this, 'permission_upload' ),
			)
		);
		register_rest_route(
			KODETY_FS_REST_NAMESPACE,
			'/uploads/(?P<id>[a-f0-9-]{36})',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'upload_status' ),
					'permission_callback' => array( $this, 'permission_upload' ),
				),
				array(
					'methods'             => 'DELETE',
					'callback'            => array( $this, 'upload_abort' ),
					'permission_callback' => array( $this, 'permission_upload' ),
				),
			)
		);
	}

	private function route( string $path, string $methods, string $callback, string $capability ): void {
		register_rest_route(
			KODETY_FS_REST_NAMESPACE,
			$path,
			array(
				'methods'             => $methods,
				'callback'            => array( $this, $callback ),
				'permission_callback' => array( $this, 'permission_' . $capability ),
			)
		);
	}

	public function permission_read(): bool { return is_user_logged_in() && current_user_can( 'kodety_files_read' ); }
	public function permission_upload(): bool { return is_user_logged_in() && current_user_can( 'kodety_files_upload' ); }
	public function permission_edit(): bool { return is_user_logged_in() && current_user_can( 'kodety_files_edit' ); }
	public function permission_edit_code(): bool { return is_user_logged_in() && current_user_can( 'kodety_files_edit' ) && current_user_can( 'kodety_files_edit_code' ); }
	public function permission_delete(): bool { return is_user_logged_in() && current_user_can( 'kodety_files_delete' ); }
	public function permission_purge(): bool { return is_user_logged_in() && current_user_can( 'kodety_files_purge' ); }
	public function permission_view_audit(): bool { return is_user_logged_in() && current_user_can( 'kodety_files_view_audit' ); }
	public function permission_manage_storage(): bool { return is_user_logged_in() && current_user_can( 'kodety_files_manage_storage' ); }

	public function bootstrap( WP_REST_Request $request ) {
		$storage_health = Kodety_FS_Local_Provider::storage_health();
		$providers = array( $this->provider_descriptor( $this->local ), $this->provider_descriptor( $this->media ) );
		if ( $this->remote_access_allowed() && ( $this->remote->configured() || current_user_can( 'kodety_files_manage_storage' ) ) ) {
			$providers[] = $this->provider_descriptor( $this->remote );
		}
		$mounts = array();
		foreach ( $this->local->mount_descriptors() as $mount ) {
			if ( 'private' === ( $mount['id'] ?? '' ) && ! current_user_can( 'kodety_files_manage_private' ) ) {
				continue;
			}
			$mounts[] = $this->mount_contract( $mount );
		}
		$mounts[] = array(
			'id'          => 'media',
			'name'        => __( 'WordPress Media', 'kodety-file-system' ),
			'provider'    => 'wordpress-media',
			'status'      => 'online',
			'visibility'  => 'public',
			'readOnly'    => ! current_user_can( 'upload_files' ),
			'permissions' => array( 'read' => true, 'write' => false, 'create' => current_user_can( 'upload_files' ), 'delete' => Kodety_FS_WordPress_Media_Provider::trash_available() && current_user_can( 'delete_posts' ), 'move' => false, 'visibility' => false, 'versions' => false ),
		);
		if ( $this->remote_access_allowed() && ( $this->remote->configured() || current_user_can( 'kodety_files_manage_storage' ) ) ) {
			$mounts[] = array(
				'id'          => 'remote',
				'name'        => __( 'Remote storage', 'kodety-file-system' ),
				'provider'    => 'remote',
				'status'      => $this->remote->configured() ? 'online' : 'offline',
				'readOnly'    => ! $this->remote->configured(),
				'permissions' => array_merge( Kodety_FS_Plugin::current_capabilities(), array( 'versions' => $this->remote->configured() ) ),
			);
		}
		$settings = Kodety_FS_Plugin::settings( false );
		$local_mount_ids = array_values( array_map( static fn( $mount ) => (string) ( $mount['id'] ?? '' ), $mounts ) );
		$current_mount = 'remote' === ( $settings['mode'] ?? 'local' ) && $this->remote->configured() && $this->remote_access_allowed()
			? 'remote'
			: ( in_array( 'project', $local_mount_ids, true ) ? 'project' : ( $local_mount_ids[0] ?? 'media' ) );
		return rest_ensure_response(
			array(
				'files'        => array(),
				'mounts'       => $mounts,
				'currentMount' => $current_mount,
				'currentPath'  => '/',
				'providers'    => $providers,
				'capabilities' => Kodety_FS_Plugin::current_capabilities(),
				'user'         => array( 'id' => get_current_user_id(), 'name' => wp_get_current_user()->display_name, 'avatarUrl' => get_avatar_url( get_current_user_id(), array( 'size' => 64 ) ) ),
				'settings'     => current_user_can( 'kodety_files_manage_storage' ) ? $settings : array( 'mode' => $settings['mode'] ),
				'storage'      => $storage_health,
				'limits'       => array(
					'maxUploadBytes'       => (int) apply_filters( 'kodety_fs_max_chunked_upload_bytes', 5 * GB_IN_BYTES ),
					'chunkThresholdBytes' => (int) wp_max_upload_size(),
					'chunkSizeBytes'      => 5 * MB_IN_BYTES,
					'editBytes'           => (int) apply_filters( 'kodety_fs_max_edit_bytes', 5 * MB_IN_BYTES ),
				),
				'features'     => array(
					'zip'            => class_exists( 'ZipArchive' ),
					'chunks'         => (bool) $storage_health['privateAvailable'],
					'versions'       => (bool) $storage_health['privateAvailable'],
					'trash'          => (bool) $storage_health['privateAvailable'],
					'wordpressMedia' => true,
					'remote'         => $this->remote->configured(),
				),
			)
		);
	}

	private function provider_descriptor( Kodety_FS_Storage_Provider $provider ): array {
		return array( 'id' => $provider->get_id(), 'label' => $provider->get_label(), 'capabilities' => $provider->get_capabilities() );
	}

	public function files( WP_REST_Request $request ) {
		$params = $this->normalize_location_params( $this->params( $request ) );
		$mount  = $this->normalize_mount( (string) ( $params['mount'] ?? 'project' ) );
		$scope  = $this->normalize_action( (string) ( $params['scope'] ?? 'files' ) );
		$access = $this->check_private( $mount );
		if ( is_wp_error( $access ) ) {
			return $access;
		}

		if ( 'trash' === $scope ) {
			$items = $this->local->trash_items( (int) ( $params['perPage'] ?? $params['per_page'] ?? 100 ) );
			if ( ! current_user_can( 'kodety_files_manage_private' ) ) {
				$items = array_values( array_filter( $items, static fn( $item ) => 'private' !== ( $item['mount'] ?? '' ) ) );
			}
			return rest_ensure_response( array( 'files' => array_map( array( $this, 'item_contract' ), $items ), 'total' => count( $items ), 'mount' => $mount, 'path' => '/' ) );
		}
		if ( 'recent' === $scope ) {
			$recent = $this->recent_items( (int) ( $params['perPage'] ?? $params['per_page'] ?? 100 ) );
			return rest_ensure_response( array( 'files' => $recent, 'total' => count( $recent ), 'mount' => $mount, 'path' => '/' ) );
		}
		if ( 'favorites' === $scope ) {
			$favorites = $this->favorite_items( (int) ( $params['perPage'] ?? $params['per_page'] ?? 200 ) );
			return rest_ensure_response( array( 'files' => $favorites, 'total' => count( $favorites ), 'mount' => $mount, 'path' => '/' ) );
		}

		$provider = $this->provider( (string) ( $params['provider'] ?? '' ), $mount );
		if ( is_wp_error( $provider ) ) {
			return $provider;
		}
		$query = (string) ( $params['query'] ?? $params['search'] ?? '' );
		if ( $provider instanceof Kodety_FS_Local_Provider ) {
			$query = $this->search_text( $query );
		}
		$result = $provider->list(
			array(
				'mount'        => $this->provider_mount( $mount ),
				'storageMount' => $params['storageMount'] ?? '',
				'path'         => $this->relative_path( (string) ( $params['path'] ?? '' ) ),
				'query'        => $query,
				'scope'        => 'files' === $scope ? 'folder' : $scope,
				'page'         => $params['page'] ?? 1,
				'per_page'     => $params['perPage'] ?? $params['per_page'] ?? 100,
			)
		);
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return rest_ensure_response( $this->list_contract( $result, $mount, (string) ( $params['storageMount'] ?? '' ) ) );
	}

	public function create_file( WP_REST_Request $request ) {
		$params = $this->normalize_location_params( $this->params( $request ) );
		if ( 'folder' !== ( $params['kind'] ?? 'file' ) ) {
			$code_access = $this->check_code_file( (string) ( $params['name'] ?? '' ) );
			if ( is_wp_error( $code_access ) ) { return $code_access; }
		}
		$access = $this->check_mutation( $params );
		if ( is_wp_error( $access ) ) {
			return $access;
		}
		$provider = $this->provider( (string) ( $params['provider'] ?? '' ), (string) ( $params['mount'] ?? '' ) );
		if ( is_wp_error( $provider ) ) {
			return $provider;
		}
		if ( $provider instanceof Kodety_FS_Local_Provider ) {
			$result = $provider->create( $params );
		} elseif ( $provider instanceof Kodety_FS_Remote_Provider ) {
			if ( ! current_user_can( 'kodety_files_manage_private' ) ) {
				$params['visibility'] = 'public';
			}
			$result = $provider->operation( array_merge( $params, array( 'action' => 'create' ) ) );
		} else {
			$result = new WP_Error( 'kodety_fs_provider_unsupported', __( 'This provider cannot create empty files or folders.', 'kodety-file-system' ), array( 'status' => 501 ) );
		}
		if ( is_wp_error( $result ) ) { return $result; }
		if ( $provider instanceof Kodety_FS_Remote_Provider ) {
			$remote_access = $this->check_remote_item_access( $result, 'write' );
			if ( is_wp_error( $remote_access ) ) { return $remote_access; }
		}
		return rest_ensure_response( $this->item_contract( $result, true, (string) ( $params['mount'] ?? '' ) ) );
	}

	public function delete_file( WP_REST_Request $request ) {
		$params = $this->hydrate_params( $this->normalize_location_params( $this->params( $request ) ) );
		if ( is_wp_error( $params ) ) {
			return $params;
		}
		$access = $this->check_private( (string) ( $params['mount'] ?? '' ) );
		if ( is_wp_error( $access ) ) {
			return $access;
		}
		$provider = $this->provider( (string) ( $params['provider'] ?? '' ), (string) ( $params['mount'] ?? '' ) );
		if ( is_wp_error( $provider ) ) {
			return $provider;
		}
		if ( $provider instanceof Kodety_FS_Remote_Provider ) {
			$item = $provider->stat( $params );
			if ( is_wp_error( $item ) ) { return $item; }
			$remote_access = $this->check_remote_item_access( $item, 'delete' );
			if ( is_wp_error( $remote_access ) ) { return $remote_access; }
		}
		$result = $provider->delete( $params );
		return is_wp_error( $result ) ? $result : rest_ensure_response( is_array( $result ) ? $this->item_contract( $result, true ) : $result );
	}

	public function upload( WP_REST_Request $request ) {
		$params = $this->normalize_location_params( $this->params( $request ) );
		unset( $params['_validatedReplace'] );
		$replace_id = sanitize_text_field( (string) ( $params['replaceId'] ?? '' ) );
		if ( '' !== $replace_id ) {
			if ( ! current_user_can( 'kodety_files_edit' ) ) {
				return new WP_Error( 'kodety_fs_replace_forbidden', __( 'Replacing an existing file requires edit permission.', 'kodety-file-system' ), array( 'status' => 403 ) );
			}
			$target = $this->hydrate_params( array( 'id' => $replace_id ) );
			if ( is_wp_error( $target ) ) {
				return $target;
			}
			if ( 'local' !== ( $target['provider'] ?? '' ) ) {
				return new WP_Error( 'kodety_fs_replace_provider', __( 'Replace currently supports local files.', 'kodety-file-system' ), array( 'status' => 501 ) );
			}
			$target_item = $this->local->stat( $target );
			if ( is_wp_error( $target_item ) ) {
				return $target_item;
			}
			if ( 'file' !== ( $target_item['kind'] ?? '' ) ) {
				return new WP_Error( 'kodety_fs_replace_folder', __( 'A folder cannot be replaced by an upload.', 'kodety-file-system' ), array( 'status' => 400 ) );
			}
			$params['provider']  = 'local';
			$params['mount']     = $target['mount'];
			$params['path']      = $this->path_parent( $target['path'] );
			$params['name']      = wp_basename( $target['path'] );
			$params['overwrite'] = true;
			$params['_validatedReplace'] = true;
		} else {
			unset( $params['overwrite'] );
		}
		$access = $this->check_mutation( $params, true );
		if ( is_wp_error( $access ) ) {
			return $access;
		}
		$provider = $this->provider( (string) ( $params['provider'] ?? '' ), (string) ( $params['mount'] ?? '' ) );
		if ( is_wp_error( $provider ) ) {
			return $provider;
		}
		$files = $this->normalize_files( $request->get_file_params() );
		if ( empty( $files ) ) {
			return new WP_Error( 'kodety_fs_no_upload', __( 'No files were uploaded.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		$items = array();
		$errors = array();
		foreach ( $files as $file ) {
			$destination_name = '' !== $replace_id ? (string) ( $params['name'] ?? '' ) : (string) ( $file['name'] ?? '' );
			$code_access = $this->check_code_file( $destination_name );
			if ( is_wp_error( $code_access ) ) {
				$errors[] = array( 'name' => $file['name'] ?? '', 'code' => $code_access->get_error_code(), 'message' => $code_access->get_error_message() );
				continue;
			}
			$dangerous_access = $this->check_dangerous_file( $destination_name, (string) ( $params['mount'] ?? '' ) );
			if ( is_wp_error( $dangerous_access ) ) {
				$errors[] = array( 'name' => $file['name'] ?? '', 'code' => $dangerous_access->get_error_code(), 'message' => $dangerous_access->get_error_message() );
				continue;
			}
			$upload_params = $params;
			if ( $provider instanceof Kodety_FS_Remote_Provider && ! current_user_can( 'kodety_files_manage_private' ) ) {
				$upload_params['visibility'] = 'public';
			}
			$result = $provider->upload( $file, $upload_params );
			if ( is_wp_error( $result ) ) {
				$errors[] = array( 'name' => $file['name'] ?? '', 'code' => $result->get_error_code(), 'message' => $result->get_error_message() );
			} else {
				if ( $provider instanceof Kodety_FS_Remote_Provider ) {
					$remote_access = $this->check_remote_item_access( $result, 'write' );
					if ( is_wp_error( $remote_access ) ) {
						$errors[] = array( 'name' => $file['name'] ?? '', 'code' => $remote_access->get_error_code(), 'message' => $remote_access->get_error_message() );
						continue;
					}
				}
				$items[] = $result;
			}
		}
		if ( 1 === count( $items ) && empty( $errors ) ) {
			return new WP_REST_Response( $this->item_contract( $items[0], true ), 201 );
		}
		if ( empty( $items ) && 1 === count( $errors ) ) {
			return new WP_Error( $errors[0]['code'], $errors[0]['message'], array( 'status' => 400 ) );
		}
		$status = empty( $errors ) ? 201 : ( empty( $items ) ? 400 : 207 );
		return new WP_REST_Response( array( 'files' => array_map( fn( $item ) => $this->item_contract( $item, true ), $items ), 'errors' => $errors, 'total' => count( $items ) ), $status );
	}

	public function operation( WP_REST_Request $request ) {
		$params = $this->normalize_location_params( $this->params( $request ) );
		$action = $this->normalize_action( (string) ( $params['action'] ?? '' ) );
		$params['action'] = $action;
		$allowed_actions = array( 'rename', 'move', 'copy', 'duplicate', 'delete', 'make-public', 'make-private', 'visibility', 'favorite', 'extract', 'compress', 'restore', 'delete-permanently', 'empty-trash' );
		if ( ! in_array( $action, $allowed_actions, true ) ) {
			return new WP_Error( 'kodety_fs_unknown_operation', __( 'Unknown file operation.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		if ( 'delete' === $action && ! current_user_can( 'kodety_files_delete' ) ) {
			return new WP_Error( 'kodety_fs_forbidden', __( 'You cannot delete files.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		if ( in_array( $action, array( 'delete-permanently', 'empty-trash' ), true ) && ! current_user_can( 'kodety_files_purge' ) ) {
			return new WP_Error( 'kodety_fs_purge_forbidden', __( 'You cannot permanently delete files.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		$destination_mount = $this->normalize_mount( (string) ( $params['toMount'] ?? $params['destinationMount'] ?? $params['mount'] ?? '' ) );
		$destination_path  = $this->relative_path( (string) ( $params['toPath'] ?? $params['destinationPath'] ?? $params['path'] ?? '' ) );
		$explicit_target   = isset( $params['toPath'] ) || isset( $params['destinationPath'] );

		if ( 'empty-trash' === $action ) {
			return $this->empty_trash();
		}

		if ( 'compress' === $action && is_array( $params['items'] ?? null ) ) {
			return $this->compress_references( $params['items'], $destination_mount, $destination_path );
		}

		$ids = $this->normalize_ids( $params['ids'] ?? ( $params['id'] ?? array() ) );
		if ( empty( $ids ) ) {
			return new WP_Error( 'kodety_fs_operation_ids', __( 'Select at least one file for this operation.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}

		if ( 'compress' === $action ) {
			return $this->compress_ids( $ids, $destination_mount, $destination_path );
		}

		$files  = array();
		$errors = array();
		foreach ( $ids as $id ) {
			if ( in_array( $action, array( 'restore', 'delete-permanently' ), true ) ) {
				$source = array( 'id' => $id, 'trashId' => $id );
			} else {
				$source = $this->hydrate_params( array_merge( $params, array( 'id' => $id ) ) );
				if ( is_wp_error( $source ) ) {
					$errors[] = $this->operation_error( $id, $source );
					continue;
				}
			}

			$operation_params = array_merge( $params, $source );
			$result = $this->perform_operation( $action, $operation_params, $destination_mount, $destination_path, $explicit_target );
			if ( is_wp_error( $result ) ) {
				$errors[] = $this->operation_error( $id, $result );
			} else {
				$files[] = is_array( $result ) ? $this->item_contract( $result, true, (string) ( $operation_params['mount'] ?? '' ) ) : $result;
			}
		}

		if ( empty( $files ) && 1 === count( $errors ) ) {
			return new WP_Error( $errors[0]['code'], $errors[0]['message'], array( 'status' => $errors[0]['status'] ) );
		}
		$status = empty( $errors ) ? 200 : ( empty( $files ) ? 400 : 207 );
		return new WP_REST_Response( array( 'files' => $files, 'errors' => $errors, 'total' => count( $files ), 'message' => empty( $errors ) ? __( 'Operation completed.', 'kodety-file-system' ) : __( 'Some items could not be processed.', 'kodety-file-system' ) ), $status );
	}

	public function content( WP_REST_Request $request ) {
		$params = $this->hydrate_params( $this->normalize_location_params( $this->params( $request ) ) );
		if ( is_wp_error( $params ) ) { return $params; }
		$access = $this->check_private( (string) ( $params['mount'] ?? '' ) );
		if ( is_wp_error( $access ) ) { return $access; }
		$provider = $this->provider( (string) ( $params['provider'] ?? '' ), (string) ( $params['mount'] ?? '' ) );
		if ( is_wp_error( $provider ) ) { return $provider; }
		$item = $provider->stat( $params );
		if ( is_wp_error( $item ) ) { return $item; }
		if ( $provider instanceof Kodety_FS_Remote_Provider ) {
			$remote_access = $this->check_remote_item_access( $item, 'read' );
			if ( is_wp_error( $remote_access ) ) { return $remote_access; }
		}
		$dangerous_access = $this->check_dangerous_file( (string) ( $item['name'] ?? $item['path'] ?? '' ), (string) ( $item['mount'] ?? $params['mount'] ?? '' ) );
		if ( is_wp_error( $dangerous_access ) ) { return $dangerous_access; }
		$text = $this->assert_text_item( $item );
		if ( is_wp_error( $text ) ) { return $text; }
		$content = $provider->read( $params );
		if ( is_wp_error( $content ) ) { return $content; }
		$text = $this->assert_text_content( $content );
		if ( is_wp_error( $text ) ) { return $text; }
		return rest_ensure_response( array( 'content' => $content, 'encoding' => 'utf-8', 'item' => $this->item_contract( $item, true ) ) );
	}

	public function update_content( WP_REST_Request $request ) {
		if ( ! current_user_can( 'kodety_files_edit_code' ) ) {
			return new WP_Error( 'kodety_fs_edit_code_forbidden', __( 'Editing file content requires the code-editing capability.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		$params = $this->hydrate_params( $this->normalize_location_params( $this->params( $request ) ) );
		if ( is_wp_error( $params ) ) { return $params; }
		$access = $this->check_mutation( $params );
		if ( is_wp_error( $access ) ) { return $access; }
		$dangerous_access = $this->check_dangerous_file( (string) ( $params['path'] ?? '' ), (string) ( $params['mount'] ?? '' ) );
		if ( is_wp_error( $dangerous_access ) ) { return $dangerous_access; }
		$provider = $this->provider( (string) ( $params['provider'] ?? '' ), (string) ( $params['mount'] ?? '' ) );
		if ( is_wp_error( $provider ) ) { return $provider; }
		$item = $provider->stat( $params );
		if ( is_wp_error( $item ) ) { return $item; }
		if ( $provider instanceof Kodety_FS_Remote_Provider ) {
			$remote_access = $this->check_remote_item_access( $item, 'write' );
			if ( is_wp_error( $remote_access ) ) { return $remote_access; }
		}
		$text = $this->assert_text_item( $item );
		if ( is_wp_error( $text ) ) { return $text; }
		if ( isset( $params['checksum'] ) && is_string( $params['checksum'] ) && '' !== $params['checksum'] && ! empty( $item['checksum'] ) && ! hash_equals( strtolower( (string) $item['checksum'] ), strtolower( $params['checksum'] ) ) ) {
			return new WP_Error( 'kodety_fs_edit_conflict', __( 'This file changed after it was opened. Reload it before saving.', 'kodety-file-system' ), array( 'status' => 409, 'checksum' => $item['checksum'] ) );
		}
		if ( ! array_key_exists( 'content', $params ) || ! is_string( $params['content'] ) ) {
			return new WP_Error( 'kodety_fs_invalid_content', __( 'Text content is required.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		$text = $this->assert_text_content( $params['content'] );
		if ( is_wp_error( $text ) ) { return $text; }
		$result = $provider->write( $params );
		return is_wp_error( $result ) ? $result : rest_ensure_response( $this->item_contract( $result, true ) );
	}

	public function versions( WP_REST_Request $request ) {
		$params = $this->hydrate_params( $this->normalize_location_params( $this->params( $request ) ) );
		if ( is_wp_error( $params ) ) { return $params; }
		$access = $this->check_private( (string) ( $params['mount'] ?? '' ) );
		if ( is_wp_error( $access ) ) { return $access; }
		if ( 'local' !== $this->provider_id( (string) ( $params['provider'] ?? '' ), (string) ( $params['mount'] ?? '' ) ) ) {
			return new WP_Error( 'kodety_fs_provider_unsupported', __( 'Versions are currently available for local storage.', 'kodety-file-system' ), array( 'status' => 501 ) );
		}
		$items = $this->local->versions( (string) $params['mount'], (string) $params['path'] );
		return rest_ensure_response( array( 'versions' => $items, 'total' => count( $items ) ) );
	}

	public function restore_version( WP_REST_Request $request ) {
		$input = $this->normalize_location_params( $this->params( $request ) );
		$version = sanitize_text_field( (string) ( $input['version'] ?? $input['versionId'] ?? $input['id'] ?? '' ) );
		$row = $this->database->version( $version );
		if ( ! $row || 'local' !== ( $row['provider'] ?? '' ) ) {
			return new WP_Error( 'kodety_fs_version_not_found', __( 'The requested version was not found.', 'kodety-file-system' ), array( 'status' => 404 ) );
		}
		$params = array(
			'id'       => (string) $row['asset_key'],
			'provider' => 'local',
			'mount'    => (string) $row['mount_id'],
			'path'     => (string) $row['path'],
		);
		$access = $this->check_mutation( $params );
		if ( is_wp_error( $access ) ) { return $access; }
		$code_access = $this->check_code_file( wp_basename( (string) $params['path'] ) );
		if ( is_wp_error( $code_access ) ) { return $code_access; }
		$result = $this->local->restore_version( $version );
		return is_wp_error( $result ) ? $result : rest_ensure_response( $this->item_contract( $result, true ) );
	}

	public function download( WP_REST_Request $request ) { return $this->stream( $request, false ); }
	public function preview( WP_REST_Request $request ) { return $this->stream( $request, true ); }

	private function stream( WP_REST_Request $request, bool $inline ) {
		$params = $this->hydrate_params( $this->normalize_location_params( $this->params( $request ) ) );
		if ( is_wp_error( $params ) ) { return $params; }
		$access = $this->check_private( (string) ( $params['mount'] ?? '' ) );
		if ( is_wp_error( $access ) ) { return $access; }
		$provider_id = $this->provider_id( (string) ( $params['provider'] ?? '' ), (string) ( $params['mount'] ?? '' ) );
		if ( 'local' === $provider_id ) {
			$file = $this->local->absolute_for_stream( $params );
		} elseif ( 'wordpress-media' === $provider_id ) {
			$id   = absint( $params['wordpressId'] ?? $params['id'] ?? $params['path'] ?? 0 );
			$path = $this->media->attached_path( $id );
			$file = is_wp_error( $path ) ? $path : array( 'absolute' => $path, 'path' => wp_basename( $path ), 'mime' => (string) get_post_mime_type( $id ), 'size' => filesize( $path ), 'mount' => 'media' );
		} else {
			return new WP_Error( 'kodety_fs_remote_stream', __( 'Use the remote provider URL endpoint to stream this file.', 'kodety-file-system' ), array( 'status' => 501 ) );
		}
		if ( is_wp_error( $file ) ) { return $file; }
		if ( headers_sent() ) {
			return new WP_Error( 'kodety_fs_headers_sent', __( 'The file cannot be streamed after output has started.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		while ( ob_get_level() ) { ob_end_clean(); }
		$total_size = max( 0, (int) $file['size'] );
		$start = 0;
		$end = max( 0, $total_size - 1 );
		$partial = false;
		$range_header = isset( $_SERVER['HTTP_RANGE'] ) ? trim( (string) wp_unslash( $_SERVER['HTTP_RANGE'] ) ) : '';
		if ( '' !== $range_header ) {
			$range = $this->parse_byte_range( $range_header, $total_size );
			if ( is_wp_error( $range ) ) {
				while ( ob_get_level() ) { ob_end_clean(); }
				status_header( 416 );
				header( 'Accept-Ranges: bytes' );
				header( 'Content-Range: bytes */' . $total_size );
				header( 'Content-Length: 0' );
				exit;
			}
			$start = $range[0];
			$end = $range[1];
			$partial = true;
		}
		nocache_headers();
		header( 'X-Content-Type-Options: nosniff' );
		header( 'Cross-Origin-Resource-Policy: same-site' );
		header( 'Accept-Ranges: bytes' );
		if ( $inline ) {
			header( "Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:" );
		}
		header( 'Content-Type: ' . ( $file['mime'] ?: 'application/octet-stream' ) );
		if ( $partial ) {
			status_header( 206 );
			header( 'Content-Range: bytes ' . $start . '-' . $end . '/' . $total_size );
		}
		$content_length = $partial ? $end - $start + 1 : $total_size;
		header( 'Content-Length: ' . $content_length );
		$disposition = $inline ? 'inline' : 'attachment';
		header( 'Content-Disposition: ' . $disposition . '; filename="' . str_replace( array( '"', "\r", "\n" ), '', wp_basename( $file['path'] ) ) . '"' );
		$handle = fopen( $file['absolute'], 'rb' );
		if ( false !== $handle ) {
			if ( $start > 0 ) { fseek( $handle, $start ); }
			$remaining = $content_length;
			while ( $remaining > 0 && ! feof( $handle ) && ! connection_aborted() ) {
				$chunk = fread( $handle, min( 64 * 1024, $remaining ) );
				if ( false === $chunk || '' === $chunk ) { break; }
				echo $chunk; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- authenticated binary stream.
				$remaining -= strlen( $chunk );
			}
			fclose( $handle );
		}
		exit;
	}

	/** @return array{0:int,1:int}|WP_Error */
	private function parse_byte_range( string $header, int $size ) {
		if ( $size <= 0 || str_contains( $header, ',' ) || ! preg_match( '/^bytes=(\d*)-(\d*)$/i', trim( $header ), $matches ) || ( '' === $matches[1] && '' === $matches[2] ) ) {
			return new WP_Error( 'kodety_fs_range', __( 'The requested byte range is not satisfiable.', 'kodety-file-system' ), array( 'status' => 416 ) );
		}
		if ( '' === $matches[1] ) {
			$suffix = (int) $matches[2];
			if ( $suffix <= 0 ) {
				return new WP_Error( 'kodety_fs_range', __( 'The requested byte range is not satisfiable.', 'kodety-file-system' ), array( 'status' => 416 ) );
			}
			return array( max( 0, $size - $suffix ), $size - 1 );
		}
		$start = (int) $matches[1];
		$end = '' === $matches[2] ? $size - 1 : min( (int) $matches[2], $size - 1 );
		if ( $start >= $size || $end < $start ) {
			return new WP_Error( 'kodety_fs_range', __( 'The requested byte range is not satisfiable.', 'kodety-file-system' ), array( 'status' => 416 ) );
		}
		return array( $start, $end );
	}

	public function metadata( WP_REST_Request $request ) {
		$params = $this->hydrate_params( $this->normalize_location_params( $this->params( $request ) ) );
		if ( is_wp_error( $params ) ) { return $params; }
		$access = $this->check_private( (string) ( $params['mount'] ?? '' ) );
		if ( is_wp_error( $access ) ) { return $access; }
		$provider = $this->provider_id( (string) ( $params['provider'] ?? '' ), (string) ( $params['mount'] ?? '' ) );
		$mount    = sanitize_key( (string) ( $params['mount'] ?? 'project' ) );
		$path     = $this->guard->normalize_relative( (string) ( $params['path'] ?? '' ), true );
		if ( is_wp_error( $path ) ) { return $path; }
		$storage = $this->provider( $provider, $mount );
		if ( is_wp_error( $storage ) ) { return $storage; }
		$item = $storage->stat( $params );
		if ( is_wp_error( $item ) ) { return $item; }
		if ( $storage instanceof Kodety_FS_Remote_Provider ) {
			$remote_access = $this->check_remote_item_access( $item, 'write' );
			if ( is_wp_error( $remote_access ) ) { return $remote_access; }
		}
		$key    = $this->database->asset_key( $provider, $mount, $path );
		$current = $this->database->metadata( $key );
		$favorite = array_key_exists( 'favorite', $params ) ? (bool) $params['favorite'] : (bool) $current['favorite'];
		$tags = array_key_exists( 'tags', $params ) && is_array( $params['tags'] ) ? $params['tags'] : $current['tags'];
		$result = $this->database->set_metadata( $key, $favorite, $tags );
		$item['favorite'] = $result['favorite'];
		$item['tags']      = $result['tags'];
		return rest_ensure_response( $this->item_contract( $item, true ) );
	}

	public function activity( WP_REST_Request $request ) {
		$items = $this->database->activity( (int) ( $request->get_param( 'limit' ) ?: 50 ), (int) ( $request->get_param( 'offset' ) ?: 0 ) );
		if ( ! current_user_can( 'kodety_files_manage_private' ) ) {
			$items = array_values( array_filter( $items, static fn( $item ) => 'private' !== ( $item['mount'] ?? '' ) ) );
		}
		return rest_ensure_response( array( 'entries' => $items, 'total' => count( $items ) ) );
	}

	public function recent( WP_REST_Request $request ) {
		$items = $this->recent_items( (int) ( $request->get_param( 'limit' ) ?: 40 ) );
		return rest_ensure_response( array( 'items' => $items, 'total' => count( $items ) ) );
	}

	public function rescan( WP_REST_Request $request ) {
		$result = $this->local->rescan( sanitize_key( (string) ( $request->get_param( 'mount' ) ?: 'project' ) ), $this->relative_path( (string) ( $request->get_param( 'path' ) ?: '' ) ) );
		return is_wp_error( $result ) ? $result : rest_ensure_response( $result );
	}

	public function settings( WP_REST_Request $request ) { return rest_ensure_response( Kodety_FS_Plugin::settings( false ) ); }

	public function update_settings( WP_REST_Request $request ) {
		$result = Kodety_FS_Plugin::update_settings( $this->params( $request ) );
		return is_wp_error( $result ) ? $result : rest_ensure_response( $result );
	}

	public function test_remote( WP_REST_Request $request ) {
		$input = array_merge( Kodety_FS_Plugin::settings( true ), $this->params( $request ) );
		$test  = new Kodety_FS_Remote_Provider( $input );
		$result = $test->test();
		return is_wp_error( $result ) ? $result : rest_ensure_response( array( 'ok' => true, 'response' => $result ) );
	}

	public function trash( WP_REST_Request $request ) {
		$items = $this->local->trash_items( (int) ( $request->get_param( 'limit' ) ?: 100 ) );
		if ( ! current_user_can( 'kodety_files_manage_private' ) ) {
			$items = array_values( array_filter( $items, static fn( $item ) => 'private' !== $item['mount'] ) );
		}
		return rest_ensure_response( array( 'items' => $items, 'total' => count( $items ) ) );
	}

	public function restore_trash( WP_REST_Request $request ) {
		$id = sanitize_text_field( (string) ( $request->get_param( 'id' ) ?: $request->get_param( 'trashId' ) ) );
		$row = $this->database->trash_item( $id );
		if ( $row ) {
			$access = $this->check_private( (string) $row['original_mount'] );
			if ( is_wp_error( $access ) ) { return $access; }
			$access = $this->check_dangerous_file( wp_basename( (string) $row['original_path'] ), (string) $row['original_mount'] );
			if ( is_wp_error( $access ) ) { return $access; }
			$access = $this->check_code_file( wp_basename( (string) $row['original_path'] ) );
			if ( is_wp_error( $access ) ) { return $access; }
		}
		$result = $this->local->restore_trash( $id );
		return is_wp_error( $result ) ? $result : rest_ensure_response( $result );
	}

	public function delete_trash( WP_REST_Request $request ) {
		$id = sanitize_text_field( (string) ( $request->get_param( 'id' ) ?: $request->get_param( 'trashId' ) ) );
		$row = $this->database->trash_item( $id );
		if ( $row ) {
			$access = $this->check_private( (string) $row['original_mount'] );
			if ( is_wp_error( $access ) ) { return $access; }
		}
		$result = $this->local->delete_trash_permanently( $id );
		return is_wp_error( $result ) ? $result : rest_ensure_response( $result );
	}

	public function import_media( WP_REST_Request $request ) {
		$id = absint( $request->get_param( 'id' ) );
		$source = $this->media->attached_path( $id );
		if ( is_wp_error( $source ) ) { return $source; }
		$code_access = $this->check_code_file( wp_basename( $source ) );
		if ( is_wp_error( $code_access ) ) { return $code_access; }
		$mount = sanitize_key( (string) ( $request->get_param( 'mount' ) ?: 'imports' ) );
		$access = $this->check_private( $mount );
		if ( is_wp_error( $access ) ) { return $access; }
		$result = $this->local->import_path( $source, $mount, (string) ( $request->get_param( 'path' ) ?: '' ), wp_basename( $source ) );
		return is_wp_error( $result ) ? $result : rest_ensure_response( $result );
	}

	public function upload_init( WP_REST_Request $request ) {
		$params = $this->normalize_location_params( $this->params( $request ) );
		$access = $this->check_mutation( $params, true );
		if ( is_wp_error( $access ) ) { return $access; }
		if ( 'local' !== $this->provider_id( (string) ( $params['provider'] ?? '' ), (string) ( $params['mount'] ?? '' ) ) ) {
			return new WP_Error( 'kodety_fs_chunk_provider', __( 'Chunked uploads currently target local storage.', 'kodety-file-system' ), array( 'status' => 501 ) );
		}
		if ( ! Kodety_FS_Local_Provider::private_storage_available() ) {
			return new WP_Error( 'kodety_fs_private_storage_unavailable', __( 'Chunked uploads require a secure private storage root. Configure KODETY_FS_PRIVATE_ROOT and try again.', 'kodety-file-system' ), array( 'status' => 503 ) );
		}
		$name = $this->guard->sanitize_name( (string) ( $params['name'] ?? '' ) );
		if ( is_wp_error( $name ) ) { return $name; }
		$code_access = $this->check_code_file( $name );
		if ( is_wp_error( $code_access ) ) { return $code_access; }
		$dangerous_access = $this->check_dangerous_file( $name, (string) ( $params['mount'] ?? '' ) );
		if ( is_wp_error( $dangerous_access ) ) { return $dangerous_access; }
		$size       = max( 0, (int) ( $params['size'] ?? 0 ) );
		$chunk_size = min( 20 * MB_IN_BYTES, max( 256 * KB_IN_BYTES, (int) ( $params['chunkSize'] ?? 5 * MB_IN_BYTES ) ) );
		$max        = (int) apply_filters( 'kodety_fs_max_chunked_upload_bytes', 5 * GB_IN_BYTES );
		if ( $size > $max ) { return new WP_Error( 'kodety_fs_upload_too_large', __( 'The upload exceeds the configured limit.', 'kodety-file-system' ), array( 'status' => 413 ) ); }
		$user_id = get_current_user_id();
		$rate_key = 'kodety_fs_upload_rate_' . $user_id;
		$rate = (int) get_transient( $rate_key );
		$rate_limit = max( 1, (int) apply_filters( 'kodety_fs_upload_init_rate_per_minute', 20 ) );
		if ( $rate >= $rate_limit ) { return new WP_Error( 'kodety_fs_upload_rate', __( 'Too many upload sessions were initialized. Try again shortly.', 'kodety-file-system' ), array( 'status' => 429 ) ); }
		$upload_root = $this->upload_storage_root();
		if ( ! is_dir( $upload_root ) && ! wp_mkdir_p( $upload_root ) ) { return new WP_Error( 'kodety_fs_upload_session', __( 'The upload storage is unavailable.', 'kodety-file-system' ), array( 'status' => 500 ) ); }
		$allocation = $this->local->begin_storage_allocation();
		if ( is_wp_error( $allocation ) ) { return $allocation; }
		try {
			// Cron is best-effort. Reap >24h sessions under the allocator lock so
			// abandoned reservations cannot accumulate indefinitely.
			Kodety_FS_Plugin::cleanup_uploads();
			$usage = $this->local->upload_reservation_usage();
			if ( is_wp_error( $usage ) ) { return $usage; }
			$user_usage = is_array( $usage['byUser'][ $user_id ] ?? null ) ? $usage['byUser'][ $user_id ] : array();
			$user_sessions = max( 0, (int) ( $user_usage['sessions'] ?? 0 ) );
			$user_reserved = max( 0, (int) ( $user_usage['reservedBytes'] ?? 0 ) );
			$global_sessions = max( 0, (int) ( $usage['sessions'] ?? 0 ) );
			$global_reserved = max( 0, (int) ( $usage['reservedBytes'] ?? 0 ) );
			$max_user_sessions = max( 1, (int) apply_filters( 'kodety_fs_max_upload_sessions_per_user', 8 ) );
			$max_global_sessions = max( $max_user_sessions, (int) apply_filters( 'kodety_fs_max_upload_sessions_global', 100 ) );
			$max_user_reserved = max( $max, (int) apply_filters( 'kodety_fs_max_upload_reserved_bytes_per_user', 10 * GB_IN_BYTES ) );
			$max_global_reserved = max( $max_user_reserved, (int) apply_filters( 'kodety_fs_max_upload_reserved_bytes_global', 100 * GB_IN_BYTES ) );
			$rate = (int) get_transient( $rate_key );
			if ( $rate >= $rate_limit ) { return new WP_Error( 'kodety_fs_upload_rate', __( 'Too many upload sessions were initialized. Try again shortly.', 'kodety-file-system' ), array( 'status' => 429 ) ); }
			if ( $user_sessions >= $max_user_sessions || $global_sessions >= $max_global_sessions || $size > $max_user_reserved - min( $user_reserved, $max_user_reserved ) || $size > $max_global_reserved - min( $global_reserved, $max_global_reserved ) ) {
				return new WP_Error( 'kodety_fs_upload_quota', __( 'The upload session or disk reservation quota has been reached.', 'kodety-file-system' ), array( 'status' => 429 ) );
			}
			$capacity = $this->local->check_storage_capacity( $size, $upload_root, $size );
			if ( is_wp_error( $capacity ) ) { return $capacity; }
			$id   = wp_generate_uuid4();
			$dir  = $upload_root . '/' . $id;
			if ( ! wp_mkdir_p( $dir ) ) { return new WP_Error( 'kodety_fs_upload_session', __( 'The upload session could not be created.', 'kodety-file-system' ), array( 'status' => 500 ) ); }
			@chmod( $dir, 0700 );
			$now = time();
			$meta = array( 'id' => $id, 'userId' => $user_id, 'mount' => sanitize_key( (string) ( $params['mount'] ?? 'project' ) ), 'path' => $this->relative_path( (string) ( $params['path'] ?? '' ) ), 'name' => $name, 'size' => $size, 'chunkSize' => $chunk_size, 'chunks' => 0 === $size ? 0 : (int) ceil( $size / $chunk_size ), 'received' => array(), 'checksum' => sanitize_text_field( (string) ( $params['checksum'] ?? '' ) ), 'createdAt' => $now, 'updatedAt' => $now );
			$initialized = false !== file_put_contents( $dir . '/.lock', '', LOCK_EX ) && false !== file_put_contents( $dir . '/meta.json', wp_json_encode( $meta ), LOCK_EX ) && false !== file_put_contents( $dir . '/payload.part', '' );
			if ( ! $initialized ) {
				@unlink( $dir . '/payload.part' ); @unlink( $dir . '/meta.json' ); @unlink( $dir . '/.lock' ); @rmdir( $dir );
				return new WP_Error( 'kodety_fs_upload_session', __( 'The upload session could not be initialized.', 'kodety-file-system' ), array( 'status' => 500 ) );
			}
			@chmod( $dir . '/meta.json', 0600 );
			@chmod( $dir . '/payload.part', 0600 );
			@chmod( $dir . '/.lock', 0600 );
			set_transient( $rate_key, $rate + 1, MINUTE_IN_SECONDS );
		} finally {
			$this->local->end_storage_allocation();
		}
		return new WP_REST_Response( array( 'id' => $id, 'uploadId' => $id, 'chunkSize' => $chunk_size, 'chunks' => $meta['chunks'], 'received' => array() ), 201 );
	}

	public function upload_chunk( WP_REST_Request $request ) {
		$session = $this->upload_session( (string) $request['id'] );
		if ( is_wp_error( $session ) ) { return $session; }
		try {
		$index_value = $request->get_param( 'index' );
		if ( null === $index_value || '' === $index_value ) {
			$index_value = $request->get_header( 'x-chunk-index' );
		}
		$index = is_numeric( $index_value ) ? (int) $index_value : -1;
		if ( $index < 0 || $index >= $session['meta']['chunks'] ) { return new WP_Error( 'kodety_fs_chunk_index', __( 'The chunk index is invalid.', 'kodety-file-system' ), array( 'status' => 400 ) ); }
		$body = $request->get_body();
		$expected_size = min( (int) $session['meta']['chunkSize'], (int) $session['meta']['size'] - $index * (int) $session['meta']['chunkSize'] );
		if ( $expected_size < 0 || strlen( $body ) !== $expected_size ) { return new WP_Error( 'kodety_fs_chunk_size', __( 'The chunk size is invalid.', 'kodety-file-system' ), array( 'status' => 400 ) ); }
		$content_range = trim( (string) $request->get_header( 'content-range' ) );
		if ( '' !== $content_range ) {
			if ( ! preg_match( '/^bytes\s+(\d+)-(\d+)\/(\d+)$/i', $content_range, $matches ) ) {
				return new WP_Error( 'kodety_fs_chunk_range', __( 'The Content-Range header is invalid.', 'kodety-file-system' ), array( 'status' => 400 ) );
			}
			$expected_start = $index * (int) $session['meta']['chunkSize'];
			if ( (int) $matches[1] !== $expected_start || (int) $matches[2] - (int) $matches[1] + 1 !== strlen( $body ) || (int) $matches[3] !== (int) $session['meta']['size'] ) {
				return new WP_Error( 'kodety_fs_chunk_range', __( 'The chunk range does not match this upload session.', 'kodety-file-system' ), array( 'status' => 409 ) );
			}
		}
		$handle = fopen( $session['dir'] . '/payload.part', 'c+b' );
		if ( ! $handle || ! flock( $handle, LOCK_EX ) || 0 !== fseek( $handle, $index * $session['meta']['chunkSize'] ) || strlen( $body ) !== fwrite( $handle, $body ) ) { if ( $handle ) { fclose( $handle ); } return new WP_Error( 'kodety_fs_chunk_write', __( 'The chunk could not be written.', 'kodety-file-system' ), array( 'status' => 500 ) ); }
		fflush( $handle ); flock( $handle, LOCK_UN ); fclose( $handle );
		$meta_handle = fopen( $session['dir'] . '/meta.json', 'c+b' );
		if ( ! $meta_handle || ! flock( $meta_handle, LOCK_EX ) ) {
			if ( $meta_handle ) { fclose( $meta_handle ); }
			return new WP_Error( 'kodety_fs_chunk_meta', __( 'The upload session could not be updated.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		$latest = json_decode( (string) stream_get_contents( $meta_handle ), true );
		if ( ! is_array( $latest ) ) { $latest = $session['meta']; }
		$latest['received'][ (string) $index ] = strlen( $body );
		$latest['updatedAt'] = time();
		rewind( $meta_handle );
		ftruncate( $meta_handle, 0 );
		$encoded = wp_json_encode( $latest );
		$meta_ok = is_string( $encoded ) && strlen( $encoded ) === fwrite( $meta_handle, $encoded );
		fflush( $meta_handle ); flock( $meta_handle, LOCK_UN ); fclose( $meta_handle );
		if ( ! $meta_ok ) { return new WP_Error( 'kodety_fs_chunk_meta', __( 'The upload session could not be updated.', 'kodety-file-system' ), array( 'status' => 500 ) ); }
		$uploaded_bytes = array_sum( array_map( 'intval', $latest['received'] ) );
		return rest_ensure_response( array( 'id' => $latest['id'], 'uploadId' => $latest['id'], 'index' => $index, 'uploadedBytes' => $uploaded_bytes, 'received' => array_map( 'intval', array_keys( $latest['received'] ) ) ) );
		} finally {
			$this->release_upload_session( $session );
		}
	}

	public function upload_complete( WP_REST_Request $request ) {
		$session = $this->upload_session( (string) $request['id'] );
		if ( is_wp_error( $session ) ) { return $session; }
		$access = $this->check_mutation( $session['meta'], true );
		if ( is_wp_error( $access ) ) { $this->release_upload_session( $session ); return $access; }
		if ( count( $session['meta']['received'] ) !== (int) $session['meta']['chunks'] || filesize( $session['dir'] . '/payload.part' ) !== (int) $session['meta']['size'] ) { $this->release_upload_session( $session ); return new WP_Error( 'kodety_fs_upload_incomplete', __( 'Not all chunks have been received.', 'kodety-file-system' ), array( 'status' => 409, 'received' => array_keys( $session['meta']['received'] ) ) ); }
		if ( '' !== $session['meta']['checksum'] && ! hash_equals( strtolower( $session['meta']['checksum'] ), hash_file( 'sha256', $session['dir'] . '/payload.part' ) ) ) { $this->release_upload_session( $session ); return new WP_Error( 'kodety_fs_upload_checksum', __( 'The upload checksum does not match.', 'kodety-file-system' ), array( 'status' => 400 ) ); }
		$result = $this->local->import_path( $session['dir'] . '/payload.part', $session['meta']['mount'], $session['meta']['path'], $session['meta']['name'] );
		if ( is_wp_error( $result ) ) { $this->release_upload_session( $session ); return $result; }
		@unlink( $session['dir'] . '/payload.part' ); @unlink( $session['dir'] . '/meta.json' );
		$this->release_upload_session( $session );
		@unlink( $session['dir'] . '/.lock' ); @rmdir( $session['dir'] );
		return rest_ensure_response( $this->item_contract( $result, true ) );
	}

	public function upload_status( WP_REST_Request $request ) {
		$session = $this->upload_session( (string) $request['id'] );
		if ( is_wp_error( $session ) ) { return $session; }
		$received = is_array( $session['meta']['received'] ?? null ) ? $session['meta']['received'] : array();
		$response = rest_ensure_response(
			array(
				'id'            => $session['meta']['id'],
				'uploadId'      => $session['meta']['id'],
				'size'          => (int) $session['meta']['size'],
				'chunkSize'     => (int) $session['meta']['chunkSize'],
				'uploadedBytes' => array_sum( array_map( 'intval', $received ) ),
				'received'      => array_map( 'intval', array_keys( $received ) ),
			)
		);
		$this->release_upload_session( $session );
		return $response;
	}

	public function upload_abort( WP_REST_Request $request ) {
		$session = $this->upload_session( (string) $request['id'] );
		if ( is_wp_error( $session ) ) { return $session; }
		@unlink( $session['dir'] . '/payload.part' );
		@unlink( $session['dir'] . '/meta.json' );
		$this->release_upload_session( $session );
		@unlink( $session['dir'] . '/.lock' );
		if ( is_dir( $session['dir'] ) && ! @rmdir( $session['dir'] ) ) {
			return new WP_Error( 'kodety_fs_upload_abort', __( 'The upload session could not be removed.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		return rest_ensure_response( array( 'id' => (string) $request['id'], 'aborted' => true ) );
	}

	/** @return array<string,mixed>|WP_Error */
	private function upload_session( string $id ) {
		if ( ! preg_match( '/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/', $id ) ) { return new WP_Error( 'kodety_fs_upload_id', __( 'The upload ID is invalid.', 'kodety-file-system' ), array( 'status' => 400 ) ); }
		$dir  = $this->upload_storage_root() . '/' . $id;
		$file = $dir . '/meta.json';
		if ( ! is_file( $file ) || is_link( $dir ) || is_link( $file ) ) { return new WP_Error( 'kodety_fs_upload_missing', __( 'The upload session was not found.', 'kodety-file-system' ), array( 'status' => 404 ) ); }
		$lock_path = $dir . '/.lock';
		if ( is_link( $lock_path ) ) { return new WP_Error( 'kodety_fs_upload_missing', __( 'The upload session is unsafe.', 'kodety-file-system' ), array( 'status' => 404 ) ); }
		$lock = @fopen( $lock_path, 'c+b' );
		if ( false === $lock || ! flock( $lock, LOCK_EX ) ) {
			if ( is_resource( $lock ) ) { fclose( $lock ); }
			return new WP_Error( 'kodety_fs_upload_lock', __( 'The upload session is busy.', 'kodety-file-system' ), array( 'status' => 409 ) );
		}
		$meta_handle = @fopen( $file, 'rb' );
		$meta_json = false;
		if ( false !== $meta_handle && flock( $meta_handle, LOCK_SH ) ) {
			$meta_json = stream_get_contents( $meta_handle );
			flock( $meta_handle, LOCK_UN );
		}
		if ( is_resource( $meta_handle ) ) { fclose( $meta_handle ); }
		$meta = is_string( $meta_json ) ? json_decode( $meta_json, true ) : null;
		if ( ! is_array( $meta ) ) {
			flock( $lock, LOCK_UN ); fclose( $lock );
			return new WP_Error( 'kodety_fs_upload_meta', __( 'The upload session metadata is invalid.', 'kodety-file-system' ), array( 'status' => 500 ) );
		}
		if ( (int) ( $meta['userId'] ?? 0 ) !== get_current_user_id() ) {
			flock( $lock, LOCK_UN ); fclose( $lock );
			return new WP_Error( 'kodety_fs_upload_forbidden', __( 'This upload session belongs to another user.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		if ( (int) ( $meta['updatedAt'] ?? $meta['createdAt'] ?? 0 ) < time() - DAY_IN_SECONDS ) {
			flock( $lock, LOCK_UN ); fclose( $lock );
			return new WP_Error( 'kodety_fs_upload_expired', __( 'The upload session has expired.', 'kodety-file-system' ), array( 'status' => 410 ) );
		}
		return array( 'dir' => $dir, 'meta' => $meta, 'lock' => $lock );
	}

	private function release_upload_session( array $session ): void {
		if ( isset( $session['lock'] ) && is_resource( $session['lock'] ) ) {
			flock( $session['lock'], LOCK_UN );
			fclose( $session['lock'] );
		}
	}

	private function upload_storage_root(): string {
		$root = method_exists( 'Kodety_FS_Local_Provider', 'system_storage_root' )
			? Kodety_FS_Local_Provider::system_storage_root()
			: Kodety_FS_Local_Provider::storage_root();
		return untrailingslashit( wp_normalize_path( $root ) ) . '/uploads';
	}

	private function mount_contract( array $mount ): array {
		$id = $this->normalize_mount( (string) ( $mount['id'] ?? '' ) );
		$permissions = is_array( $mount['permissions'] ?? null ) ? $mount['permissions'] : array();
		$edit = (bool) ( $permissions['write'] ?? current_user_can( 'kodety_files_edit' ) );
		return array_merge(
			$mount,
			array(
				'id'          => $id,
				'name'        => (string) ( $mount['name'] ?? $mount['label'] ?? ucfirst( $id ) ),
				'label'       => (string) ( $mount['label'] ?? $mount['name'] ?? ucfirst( $id ) ),
				'provider'    => 'local',
				'status'      => 'online',
				'readOnly'    => ! $edit,
				'permissions' => array_merge(
					array(
						'read'       => current_user_can( 'kodety_files_read' ),
						'write'      => $edit,
						'create'     => $edit,
						'upload'     => current_user_can( 'kodety_files_upload' ),
						'delete'     => current_user_can( 'kodety_files_delete' ),
						'move'       => $edit,
						'visibility' => $edit,
						'editCode'   => current_user_can( 'kodety_files_edit_code' ),
						'versions'   => current_user_can( 'kodety_files_read' ),
					),
					$permissions
				),
			)
		);
	}

	private function list_contract( array $result, string $fallback_mount, string $fallback_storage_mount = '' ): array {
		$source = array();
		if ( isset( $result['items'] ) && is_array( $result['items'] ) ) {
			$source = $result['items'];
		} elseif ( isset( $result['files'] ) && is_array( $result['files'] ) ) {
			$source = $result['files'];
		} elseif ( array() === $result || array_keys( $result ) === range( 0, count( $result ) - 1 ) ) {
			$source = $result;
		}
		$is_remote_result = 'remote' === $this->provider_id( (string) ( $result['provider'] ?? '' ), $fallback_mount );
		$storage_mount = $is_remote_result
			? $this->normalize_storage_mount( (string) ( $result['storageMount'] ?? $result['storage_mount'] ?? ( '' !== $fallback_storage_mount ? $fallback_storage_mount : ( $result['mount'] ?? '' ) ) ) )
			: '';
		$files = array();
		foreach ( $source as $item ) {
			if ( is_array( $item ) ) {
				$is_remote = 'remote' === $this->provider_id( (string) ( $item['provider'] ?? '' ), $fallback_mount );
				if ( $is_remote && empty( $item['storageMount'] ) && empty( $item['storage_mount'] ) && empty( $item['mount'] ) ) {
					$item['storageMount'] = $storage_mount;
				}
				if ( $is_remote && is_wp_error( $this->check_remote_item_access( $item, 'read' ) ) ) {
					continue;
				}
				$files[] = $this->item_contract( $item, true, $fallback_mount );
			}
		}
		return array(
			'files'      => $files,
			'items'      => $files,
			'total'      => $is_remote_result ? count( $files ) : ( isset( $result['total'] ) ? (int) $result['total'] : count( $files ) ),
			'mount'      => $fallback_mount,
			'storageMount' => $storage_mount ?: null,
			'path'       => $this->relative_path( (string) ( $result['path'] ?? '' ) ),
			'nextCursor' => $result['nextCursor'] ?? $result['next_cursor'] ?? null,
		);
	}

	private function item_contract( array $item, bool $index = false, string $fallback_mount = '' ): array {
		$mount_value = $item['mount'] ?? ( '' !== $fallback_mount ? $fallback_mount : 'project' );
		$mount    = $this->normalize_mount( (string) $mount_value );
		$declared_provider = $this->provider_id( (string) ( $item['provider'] ?? '' ), $mount );
		$storage_mount_value = $item['storageMount'] ?? $item['storage_mount'] ?? ( 'remote' === $declared_provider && 'remote' === $mount ? '' : $mount_value );
		$storage_mount = $this->normalize_storage_mount( (string) $storage_mount_value );
		if ( 'remote' !== $declared_provider && str_starts_with( (string) ( $item['id'] ?? '' ), 'wp-media:' ) ) {
			$item['provider'] = 'wordpress-media';
			$mount = 'media';
		}
		$provider = $this->provider_id( (string) ( $item['provider'] ?? '' ), $mount );
		if ( 'wordpress-media' === $provider ) {
			$mount = 'media';
		} elseif ( 'remote' === $provider ) {
			$item['storageMount'] = $storage_mount;
			$mount = 'remote';
		}
		$path = $this->relative_path( (string) ( $item['path'] ?? '' ) );
		$item['mount']    = $mount;
		$item['provider'] = $provider;
		$item['path']     = $path;
		$item['name']     = (string) ( $item['name'] ?? wp_basename( $path ) );
		$item['kind']     = 'folder' === ( $item['kind'] ?? '' ) ? 'folder' : 'file';

		if ( 'local' === $provider && preg_match( '/^[a-f0-9]{64}$/', (string) ( $item['id'] ?? '' ) ) ) {
			if ( $index ) {
				$this->database->upsert_asset( $item );
			}
			$metadata = $this->database->metadata( (string) $item['id'] );
			$item['favorite'] = $metadata['favorite'];
			$item['tags']      = $metadata['tags'];
			if ( 'file' === $item['kind'] ) {
				$item['previewUrl'] = add_query_arg(
					array( 'id' => $item['id'], '_wpnonce' => wp_create_nonce( 'wp_rest' ) ),
					rest_url( KODETY_FS_REST_NAMESPACE . '/preview' )
				);
			}
		} elseif ( 'wordpress-media' === $provider ) {
			$wordpress_value = $item['wordpressId'] ?? $item['id'] ?? $path;
			if ( is_string( $wordpress_value ) && str_starts_with( $wordpress_value, 'wp-media:' ) ) {
				$wordpress_value = substr( $wordpress_value, 9 );
			}
			$wordpress_id = absint( $wordpress_value );
			$item['id']   = 'wp-media:' . $wordpress_id;
			$item['path'] = (string) $wordpress_id;
			$key = $this->database->asset_key( $provider, 'media', (string) $wordpress_id );
			$metadata = $this->database->metadata( $key );
			$item['favorite'] = $metadata['favorite'];
			$item['tags']      = $metadata['tags'];
			if ( $index ) {
				$this->database->upsert_asset( array_merge( $item, array( 'id' => $key ) ) );
			}
		}
		if ( ! isset( $item['favorite'] ) ) { $item['favorite'] = false; }
		if ( ! isset( $item['tags'] ) || ! is_array( $item['tags'] ) ) { $item['tags'] = array(); }
		return $item;
	}

	/** @return array<string,mixed>|WP_Error */
	private function hydrate_params( array $params ) {
		$params = $this->normalize_location_params( $params );
		$id = sanitize_text_field( (string) ( $params['id'] ?? '' ) );
		if ( '' === $id ) {
			if ( isset( $params['path'] ) ) {
				$params['provider'] = $this->provider_id( (string) ( $params['provider'] ?? '' ), (string) ( $params['mount'] ?? '' ) );
				return $params;
			}
			return new WP_Error( 'kodety_fs_asset_id', __( 'A file ID is required.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		$explicit_provider = $this->provider_id( (string) ( $params['provider'] ?? '' ), (string) ( $params['mount'] ?? '' ) );
		if ( 'remote' === $explicit_provider ) {
			if ( ! isset( $params['path'] ) ) {
				return new WP_Error( 'kodety_fs_asset_not_found', __( 'Remote items require their provider-owned path locator.', 'kodety-file-system' ), array( 'status' => 404 ) );
			}
			$params['provider'] = 'remote';
			$params['mount']    = 'remote';
			$params['storageMount'] = $this->normalize_storage_mount( (string) ( $params['storageMount'] ?? '' ) );
			$params['path']     = $this->relative_path( (string) $params['path'] );
			return $params;
		}

		if ( str_starts_with( $id, 'wp-media:' ) ) {
			$wordpress_id = absint( substr( $id, 9 ) );
			if ( ! $wordpress_id ) {
				return new WP_Error( 'kodety_fs_asset_id', __( 'The WordPress media ID is invalid.', 'kodety-file-system' ), array( 'status' => 400 ) );
			}
			$params['id']          = $wordpress_id;
			$params['wordpressId'] = $wordpress_id;
			$params['provider']    = 'wordpress-media';
			$params['mount']       = 'media';
			$params['path']        = (string) $wordpress_id;
			return $params;
		}

		if ( preg_match( '/^[a-f0-9]{64}$/', $id ) ) {
			$asset = $this->database->asset_by_key( $id );
			if ( $asset ) {
				// The ID owns the storage locator, while operation-specific fields such
				// as a new rename target must survive hydration.
				$params['id']       = $id;
				$params['provider'] = (string) $asset['provider'];
				$params['mount']    = (string) $asset['mount'];
				$params['path']     = (string) $asset['path'];
				return $params;
			}
			$provider = $this->provider_id( (string) ( $params['provider'] ?? '' ), (string) ( $params['mount'] ?? '' ) );
			$mount = $this->provider_mount( (string) ( $params['mount'] ?? 'project' ) );
			$path = $this->relative_path( (string) ( $params['path'] ?? '' ) );
			if ( '' !== $path && hash_equals( $id, $this->database->asset_key( $provider, $mount, $path ) ) ) {
				$params['provider'] = $provider;
				$params['mount']    = $mount;
				$params['path']     = $path;
				return $params;
			}
			return new WP_Error( 'kodety_fs_asset_not_found', __( 'The selected file could not be resolved.', 'kodety-file-system' ), array( 'status' => 404 ) );
		}

		return new WP_Error( 'kodety_fs_asset_not_found', __( 'The selected file could not be resolved.', 'kodety-file-system' ), array( 'status' => 404 ) );
	}

	private function normalize_location_params( array $params ): array {
		$aliases = array(
			'to_mount' => 'toMount', 'to-mount' => 'toMount', 'destination_mount' => 'destinationMount', 'destination-mount' => 'destinationMount',
			'to_path' => 'toPath', 'to-path' => 'toPath', 'destination_path' => 'destinationPath', 'destination-path' => 'destinationPath',
			'replace_id' => 'replaceId', 'replace-id' => 'replaceId', 'trash_id' => 'trashId', 'trash-id' => 'trashId', 'version_id' => 'versionId', 'version-id' => 'versionId',
			'storage_mount' => 'storageMount', 'storage-mount' => 'storageMount', 'to_storage_mount' => 'toStorageMount', 'to-storage-mount' => 'toStorageMount',
		);
		foreach ( $aliases as $alias => $canonical ) {
			if ( ! array_key_exists( $canonical, $params ) && array_key_exists( $alias, $params ) ) {
				$params[ $canonical ] = $params[ $alias ];
			}
		}
		foreach ( array( 'path', 'toPath', 'destinationPath' ) as $key ) {
			if ( array_key_exists( $key, $params ) ) {
				$params[ $key ] = $this->relative_path( (string) $params[ $key ] );
			}
		}
		foreach ( array( 'mount', 'toMount', 'destinationMount' ) as $key ) {
			if ( array_key_exists( $key, $params ) ) {
				$params[ $key ] = $this->normalize_mount( (string) $params[ $key ] );
			}
		}
		foreach ( array( 'storageMount', 'toStorageMount' ) as $key ) {
			if ( array_key_exists( $key, $params ) ) {
				$params[ $key ] = $this->normalize_storage_mount( (string) $params[ $key ] );
			}
		}
		return $params;
	}

	private function relative_path( string $path ): string {
		return trim( str_replace( '\\', '/', $path ), '/' );
	}

	private function search_text( string $query ): string {
		$tokens = preg_split( '/\s+/', trim( $query ) ) ?: array();
		$plain = array_filter(
			$tokens,
			static fn( $token ) => ! preg_match( '/^(?:type|extension|ext|visibility|modified|tag|size):/i', (string) $token )
		);
		return sanitize_text_field( implode( ' ', $plain ) );
	}

	private function path_parent( string $path ): string {
		$parent = dirname( $path );
		return '.' === $parent ? '' : $this->relative_path( $parent );
	}

	private function normalize_mount( string $mount ): string {
		$mount = sanitize_key( $mount );
		if ( in_array( $mount, array( 'wordpress', 'wordpress-media', 'wordpress_media', 'wp-media' ), true ) ) { return 'media'; }
		return '' === $mount ? 'project' : $mount;
	}

	private function normalize_storage_mount( string $mount ): string {
		return sanitize_key( $mount );
	}

	private function provider_mount( string $mount ): string {
		$mount = $this->normalize_mount( $mount );
		if ( 'media' === $mount ) { return 'media'; }
		if ( 'remote' === $mount ) { return 'remote'; }
		return $mount;
	}

	private function normalize_action( string $action ): string {
		$action = str_replace( '_', '-', sanitize_key( $action ) );
		$aliases = array(
			'permanent-delete' => 'delete-permanently',
			'delete-permanent' => 'delete-permanently',
			'delete-permanently' => 'delete-permanently',
		);
		return $aliases[ $action ] ?? $action;
	}

	/** @return array<int,string> */
	private function normalize_ids( $ids ): array {
		if ( is_string( $ids ) || is_numeric( $ids ) ) { $ids = array( $ids ); }
		if ( ! is_array( $ids ) ) { return array(); }
		$out = array();
		foreach ( $ids as $id ) {
			$id = sanitize_text_field( (string) $id );
			if ( '' !== $id ) { $out[ $id ] = $id; }
		}
		return array_values( $out );
	}

	private function operation_error( string $id, WP_Error $error ): array {
		$data = $error->get_error_data();
		return array(
			'id'      => $id,
			'code'    => $error->get_error_code(),
			'message' => $error->get_error_message(),
			'status'  => is_array( $data ) ? (int) ( $data['status'] ?? 400 ) : 400,
		);
	}

	/** @return array<string,mixed>|WP_Error */
	private function perform_operation( string $action, array $params, string $destination_mount, string $destination_path, bool $explicit_target ) {
		if ( 'restore' === $action || 'delete-permanently' === $action ) {
			$id = sanitize_text_field( (string) ( $params['trashId'] ?? $params['id'] ?? '' ) );
			$row = $this->database->trash_item( $id );
			if ( $row ) {
				$access = $this->check_private( (string) $row['original_mount'] );
				if ( is_wp_error( $access ) ) { return $access; }
				if ( 'restore' === $action ) {
					$access = $this->check_dangerous_file( wp_basename( (string) $row['original_path'] ), (string) $row['original_mount'] );
					if ( is_wp_error( $access ) ) { return $access; }
					$access = $this->check_code_file( wp_basename( (string) $row['original_path'] ) );
					if ( is_wp_error( $access ) ) { return $access; }
				}
			}
			return 'restore' === $action ? $this->local->restore_trash( $id ) : $this->local->delete_trash_permanently( $id );
		}

		$access = $this->check_mutation( $params );
		if ( is_wp_error( $access ) ) { return $access; }
		if ( in_array( $action, array( 'rename', 'move', 'copy', 'duplicate' ), true ) ) {
			$code_access = $this->check_code_file( wp_basename( (string) ( $params['path'] ?? '' ) ) );
			if ( is_wp_error( $code_access ) ) { return $code_access; }
			$target_name = 'rename' === $action
				? (string) ( $params['name'] ?? '' )
				: ( $explicit_target ? wp_basename( $destination_path ) : wp_basename( (string) ( $params['path'] ?? '' ) ) );
			if ( '' !== $target_name ) {
				$code_access = $this->check_code_file( $target_name );
				if ( is_wp_error( $code_access ) ) { return $code_access; }
			}
		}
		if ( in_array( $action, array( 'make-public', 'make-private', 'visibility' ), true ) && ! current_user_can( 'kodety_files_manage_private' ) ) {
			return new WP_Error( 'kodety_fs_visibility_forbidden', __( 'You cannot change asset visibility.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		$provider = $this->provider( (string) ( $params['provider'] ?? '' ), (string) ( $params['mount'] ?? '' ) );
		if ( is_wp_error( $provider ) ) { return $provider; }
		if ( $provider instanceof Kodety_FS_Remote_Provider ) {
			$remote_allowed = array( 'rename', 'move', 'copy', 'duplicate', 'delete', 'make-public', 'make-private', 'visibility', 'favorite', 'extract' );
			if ( ! in_array( $action, $remote_allowed, true ) ) {
				return new WP_Error( 'kodety_fs_provider_unsupported', __( 'This remote operation is not supported by the WordPress adapter.', 'kodety-file-system' ), array( 'status' => 501 ) );
			}
			$remote_item = $provider->stat( $params );
			if ( is_wp_error( $remote_item ) ) { return $remote_item; }
			$permission = in_array( $action, array( 'delete' ), true ) ? 'delete' : ( in_array( $action, array( 'move', 'copy', 'rename', 'duplicate' ), true ) ? 'move' : 'write' );
			$remote_access = $this->check_remote_item_access( $remote_item, $permission );
			if ( is_wp_error( $remote_access ) ) { return $remote_access; }
			$remote_args = array_merge( $params, array( 'action' => $action, 'toMount' => $destination_mount, 'toPath' => $destination_path ) );
			if ( ! current_user_can( 'kodety_files_manage_private' ) ) {
				$remote_args['destinationVisibility'] = 'public';
			}
			if ( 'delete' === $action ) {
				$remote_args['action'] = 'trash';
				$remote_args['permanent'] = false;
			}
			$result = $provider->operation( $remote_args );
			if ( is_wp_error( $result ) ) { return $result; }
			if ( is_array( $result ) && isset( $result['id'] ) ) {
				$remote_access = $this->check_remote_item_access( $result, 'read' );
				if ( is_wp_error( $remote_access ) ) { return $remote_access; }
			}
			return $result;
		}
		if ( $provider instanceof Kodety_FS_WordPress_Media_Provider ) {
			return 'delete' === $action ? $provider->delete( $params ) : new WP_Error( 'kodety_fs_provider_unsupported', __( 'This operation is not supported by WordPress Media.', 'kodety-file-system' ), array( 'status' => 501 ) );
		}

		switch ( $action ) {
			case 'rename':
				$name = $this->guard->sanitize_name( (string) ( $params['name'] ?? '' ) );
				if ( is_wp_error( $name ) ) { return $name; }
				return $this->local->move( array_merge( $params, array( 'toMount' => $params['mount'], 'toPath' => ( '' === $this->path_parent( $params['path'] ) ? '' : $this->path_parent( $params['path'] ) . '/' ) . $name ) ) );
			case 'move':
			case 'copy':
				$to_mount = '' === $destination_mount ? (string) $params['mount'] : $destination_mount;
				$to_path = $explicit_target ? $destination_path : ( '' === $destination_path ? wp_basename( $params['path'] ) : $destination_path . '/' . wp_basename( $params['path'] ) );
				$transition = $this->check_visibility_transition( (string) $params['mount'], $to_mount );
				if ( is_wp_error( $transition ) ) { return $transition; }
				$target_access = $this->check_private( $to_mount );
				if ( is_wp_error( $target_access ) ) { return $target_access; }
				$args = array_merge( $params, array( 'toMount' => $to_mount, 'toPath' => $to_path ) );
				return 'move' === $action ? $this->local->move( $args ) : $this->local->copy( $args );
			case 'duplicate':
				return $this->local->duplicate( $params );
			case 'delete':
				return $this->local->delete( $params );
			case 'make-public':
			case 'make-private':
			case 'visibility':
				if ( ! current_user_can( 'kodety_files_manage_private' ) ) {
					return new WP_Error( 'kodety_fs_visibility_forbidden', __( 'You cannot change asset visibility.', 'kodety-file-system' ), array( 'status' => 403 ) );
				}
				$params['visibility'] = 'make-public' === $action ? 'public' : ( 'make-private' === $action ? 'private' : ( $params['visibility'] ?? 'private' ) );
				return $this->local->set_visibility( $params );
			case 'favorite':
				$key = $this->database->asset_key( 'local', (string) $params['mount'], (string) $params['path'] );
				$current = $this->database->metadata( $key );
				$this->database->set_metadata( $key, array_key_exists( 'favorite', $params ) ? (bool) $params['favorite'] : ! $current['favorite'], $current['tags'] );
				return $this->local->stat( $params );
			case 'extract':
				$target = '' === $destination_path ? $this->path_parent( (string) $params['path'] ) : $destination_path;
				return $this->local->extract( (string) $params['mount'], (string) $params['path'], $target );
			default:
				return new WP_Error( 'kodety_fs_unknown_operation', __( 'Unknown file operation.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
	}

	private function compress_references( array $references, string $destination_mount, string $destination_path ) {
		$sources = array();
		foreach ( $references as $reference ) {
			if ( ! is_array( $reference ) ) { continue; }
			$source = $this->hydrate_params( $reference );
			if ( is_wp_error( $source ) ) { return $source; }
			if ( 'local' !== ( $source['provider'] ?? '' ) ) {
				return new WP_Error( 'kodety_fs_provider_unsupported', __( 'Only local files can be compressed here.', 'kodety-file-system' ), array( 'status' => 501 ) );
			}
			$access = $this->check_private( (string) $source['mount'] );
			if ( is_wp_error( $access ) ) { return $access; }
			$sources[] = $source;
		}
		if ( empty( $sources ) ) {
			return new WP_Error( 'kodety_fs_operation_ids', __( 'Select at least one file to compress.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		$destination_mount = '' === $destination_mount ? (string) $sources[0]['mount'] : $destination_mount;
		foreach ( $sources as $source ) {
			$transition = $this->check_visibility_transition( (string) $source['mount'], $destination_mount );
			if ( is_wp_error( $transition ) ) { return $transition; }
		}
		$access = $this->check_private( $destination_mount );
		if ( is_wp_error( $access ) ) { return $access; }
		$result = $this->local->compress( $sources, $destination_mount, $destination_path );
		return is_wp_error( $result ) ? $result : rest_ensure_response( array( 'files' => array( $this->item_contract( $result, true ) ), 'total' => 1 ) );
	}

	private function compress_ids( array $ids, string $destination_mount, string $destination_path ) {
		$references = array_map( static fn( $id ) => array( 'id' => $id ), $ids );
		return $this->compress_references( $references, $destination_mount, $destination_path );
	}

	private function empty_trash() {
		$files  = array();
		$errors = array();
		$seen   = array();
		$limit  = 10000;

		while ( count( $seen ) < $limit ) {
			$items = $this->database->trash_items( min( 500, $limit - count( $seen ) ) );
			if ( empty( $items ) ) {
				break;
			}
			$deleted_in_batch = 0;
			foreach ( $items as $item ) {
				$id = sanitize_text_field( (string) ( $item['id'] ?? '' ) );
				if ( '' === $id || isset( $seen[ $id ] ) ) {
					continue;
				}
				$seen[ $id ] = true;
				$access = $this->check_private( (string) ( $item['mount'] ?? '' ) );
				if ( is_wp_error( $access ) ) {
					$errors[] = $this->operation_error( $id, $access );
					continue;
				}
				$result = $this->local->delete_trash_permanently( $id );
				if ( is_wp_error( $result ) ) {
					$errors[] = $this->operation_error( $id, $result );
					continue;
				}
				$files[] = $this->item_contract( $result, false, (string) ( $item['mount'] ?? '' ) );
				++$deleted_in_batch;
			}
			// If a whole result page is inaccessible or failed, another query would
			// return the same rows forever.
			if ( 0 === $deleted_in_batch ) {
				break;
			}
		}

		$remaining = $this->database->trash_items( 1 );
		if ( ! empty( $remaining ) && count( $seen ) >= $limit ) {
			$errors[] = array(
				'id'      => '',
				'code'    => 'kodety_fs_trash_limit',
				'message' => __( 'The trash still contains items. Run empty trash again to continue.', 'kodety-file-system' ),
				'status'  => 409,
			);
		}
		$status = empty( $errors ) ? 200 : ( empty( $files ) ? 403 : 207 );
		return new WP_REST_Response(
			array(
				'files'   => $files,
				'errors'  => $errors,
				'total'   => count( $files ),
				'message' => empty( $errors ) ? __( 'Trash emptied.', 'kodety-file-system' ) : __( 'Some trash items could not be deleted.', 'kodety-file-system' ),
			),
			$status
		);
	}

	/** @return true|WP_Error */
	private function assert_text_item( array $item ) {
		if ( 'file' !== ( $item['kind'] ?? '' ) ) {
			return new WP_Error( 'kodety_fs_content_folder', __( 'Folders do not have editable text content.', 'kodety-file-system' ), array( 'status' => 400 ) );
		}
		$extension = strtolower( pathinfo( (string) ( $item['name'] ?? $item['path'] ?? '' ), PATHINFO_EXTENSION ) );
		$mime = strtolower( (string) ( $item['mimeType'] ?? '' ) );
		$text_extensions = array( 'html', 'htm', 'css', 'scss', 'sass', 'less', 'js', 'jsx', 'ts', 'tsx', 'json', 'svg', 'xml', 'txt', 'md', 'php', 'yml', 'yaml', 'env', 'ini', 'conf', 'sql' );
		$text_mimes = array( 'application/json', 'application/javascript', 'application/xml', 'application/xhtml+xml', 'image/svg+xml' );
		if ( ! in_array( $extension, $text_extensions, true ) && ! str_starts_with( $mime, 'text/' ) && ! in_array( $mime, $text_mimes, true ) ) {
			return new WP_Error( 'kodety_fs_binary_content', __( 'Binary files cannot be opened or edited through the content endpoint.', 'kodety-file-system' ), array( 'status' => 415 ) );
		}
		return true;
	}

	/** @return true|WP_Error */
	private function assert_text_content( string $content ) {
		if ( str_contains( $content, "\0" ) || 1 !== preg_match( '//u', $content ) ) {
			return new WP_Error( 'kodety_fs_binary_content', __( 'The content is not valid UTF-8 text.', 'kodety-file-system' ), array( 'status' => 415 ) );
		}
		return true;
	}

	/** @return array<int,array<string,mixed>> */
	private function recent_items( int $limit ): array {
		$items = array();
		foreach ( $this->database->recent( min( 200, max( 1, $limit ) ) ) as $ref ) {
			if ( 'local' !== ( $ref['provider'] ?? '' ) || 'private' === ( $ref['mount'] ?? '' ) && ! current_user_can( 'kodety_files_manage_private' ) ) { continue; }
			$item = $this->local->stat( $ref );
			if ( ! is_wp_error( $item ) ) { $items[] = $this->item_contract( $item, true ); }
		}
		return $items;
	}

	/** @return array<int,array<string,mixed>> */
	private function favorite_items( int $limit ): array {
		$items = array();
		foreach ( $this->database->favorite_assets( min( 500, max( 1, $limit ) ) ) as $ref ) {
			if ( 'private' === ( $ref['mount'] ?? '' ) && ! current_user_can( 'kodety_files_manage_private' ) ) { continue; }
			$provider = $this->provider( (string) $ref['provider'], (string) $ref['mount'] );
			$item = is_wp_error( $provider ) ? $provider : $provider->stat( $ref );
			if ( ! is_wp_error( $item ) ) { $items[] = $this->item_contract( $item, false ); }
		}
		return $items;
	}

	/** @return Kodety_FS_Storage_Provider|WP_Error */
	private function provider( string $id, string $mount = '' ) {
		$id = $this->provider_id( $id, $mount );
		if ( 'local' === $id ) { return $this->local; }
		if ( 'wordpress-media' === $id ) { return $this->media; }
		if ( 'remote' === $id ) {
			return $this->remote_access_allowed()
				? $this->remote
				: new WP_Error( 'kodety_fs_remote_forbidden', __( 'Remote storage is restricted to storage administrators unless delegated access is explicitly enabled.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		return new WP_Error( 'kodety_fs_provider', __( 'Unknown storage provider.', 'kodety-file-system' ), array( 'status' => 400 ) );
	}

	private function provider_id( string $id, string $mount = '' ): string {
		$id = sanitize_key( $id );
		$mount = $this->normalize_mount( $mount );
		if ( in_array( $id, array( 'wordpress', 'wordpress-media', 'wordpress_media', 'media', 'wp-media' ), true ) || 'media' === $mount ) { return 'wordpress-media'; }
		if ( in_array( $id, array( 'filesystem', 'backend-filesystem', 'backend_filesystem' ), true ) ) { return 'local'; }
		if ( 'remote' === $mount && '' === $id ) { return 'remote'; }
		return '' === $id ? 'local' : $id;
	}

	private function remote_access_allowed(): bool {
		return current_user_can( 'kodety_files_manage_storage' )
			|| ( defined( 'KODETY_FS_REMOTE_DELEGATED_ACCESS' ) && true === KODETY_FS_REMOTE_DELEGATED_ACCESS && current_user_can( 'kodety_files_read' ) );
	}

	/** @return true|WP_Error */
	private function check_remote_item_access( array $item, string $operation = 'read' ) {
		$visibility = sanitize_key( (string) ( $item['visibility'] ?? ( ! empty( $item['private'] ) ? 'private' : '' ) ) );
		$storage_mount = sanitize_key( (string) ( $item['storageMount'] ?? $item['mount'] ?? '' ) );
		$protected = ! in_array( $visibility, array( 'public', 'shared' ), true ) || 'private' === $storage_mount;
		if ( $protected && ! current_user_can( 'kodety_files_manage_private' ) ) {
			return new WP_Error( 'kodety_fs_remote_private_forbidden', __( 'The remote item is protected or did not provide an explicit public visibility.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		$permissions = is_array( $item['permissions'] ?? null ) ? $item['permissions'] : array();
		$permission_key = in_array( $operation, array( 'write', 'delete', 'move', 'read' ), true ) ? $operation : 'read';
		if ( array_key_exists( $permission_key, $permissions ) && ! $permissions[ $permission_key ] ) {
			return new WP_Error( 'kodety_fs_remote_acl_forbidden', __( 'The remote item ACL does not allow this operation.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		if ( 'read' !== $permission_key && ! array_key_exists( $permission_key, $permissions ) && ! current_user_can( 'kodety_files_manage_private' ) ) {
			return new WP_Error( 'kodety_fs_remote_acl_missing', __( 'The remote API must return an explicit per-item permission for this operation.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		return true;
	}

	/** @return true|WP_Error */
	private function check_private( string $mount ) {
		if ( 'private' === sanitize_key( $mount ) && ! current_user_can( 'kodety_files_manage_private' ) ) {
			return new WP_Error( 'kodety_fs_private_forbidden', __( 'You cannot access private storage.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		return true;
	}

	/** @return true|WP_Error */
	private function check_visibility_transition( string $source_mount, string $destination_mount ) {
		$source_mount      = $this->normalize_mount( $source_mount );
		$destination_mount = $this->normalize_mount( $destination_mount );
		if ( $source_mount !== $destination_mount && in_array( 'public', array( $source_mount, $destination_mount ), true ) && ! current_user_can( 'kodety_files_manage_private' ) ) {
			return new WP_Error( 'kodety_fs_visibility_forbidden', __( 'Moving assets between protected and public storage requires private-storage permission.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		return true;
	}

	/** @return true|WP_Error */
	private function check_mutation( array $params, bool $upload = false ) {
		$access = $this->check_private( (string) ( $params['mount'] ?? '' ) );
		if ( is_wp_error( $access ) ) { return $access; }
		$access = $this->check_private( (string) ( $params['toMount'] ?? '' ) );
		if ( is_wp_error( $access ) ) { return $access; }
		$name = (string) ( $params['name'] ?? $params['path'] ?? '' );
		$dangerous_access = $this->check_dangerous_file( $name, (string) ( $params['mount'] ?? '' ) );
		if ( is_wp_error( $dangerous_access ) ) { return $dangerous_access; }
		if ( isset( $params['toPath'] ) || isset( $params['destinationPath'] ) ) {
			$target_path = (string) ( $params['toPath'] ?? $params['destinationPath'] );
			$target_mount = (string) ( $params['toMount'] ?? $params['destinationMount'] ?? $params['mount'] ?? '' );
			$dangerous_access = $this->check_dangerous_file( wp_basename( $target_path ), $target_mount );
			if ( is_wp_error( $dangerous_access ) ) { return $dangerous_access; }
		}
		if ( $upload && ! current_user_can( 'kodety_files_upload' ) ) { return new WP_Error( 'kodety_fs_forbidden', __( 'You cannot upload files.', 'kodety-file-system' ), array( 'status' => 403 ) ); }
		return true;
	}

	/** @return true|WP_Error */
	private function check_dangerous_file( string $name, string $mount ) {
		if ( ! $this->guard->is_dangerous_edit_name( $name ) ) {
			return true;
		}
		$enabled = defined( 'KODETY_FS_ENABLE_DANGEROUS_FILE_EDITING' ) && true === KODETY_FS_ENABLE_DANGEROUS_FILE_EDITING;
		if ( ! $enabled || ! current_user_can( 'kodety_files_edit_code' ) ) {
			return new WP_Error( 'kodety_fs_dangerous_edit_disabled', __( 'This sensitive file type requires the code-editing capability and KODETY_FS_ENABLE_DANGEROUS_FILE_EDITING.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		if ( ! in_array( $this->normalize_mount( $mount ), array( 'project', 'private', 'imports' ), true ) ) {
			return new WP_Error( 'kodety_fs_dangerous_edit_mount', __( 'Sensitive file types can only be stored in a protected local mount.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		return true;
	}

	/** @return true|WP_Error */
	private function check_code_file( string $name ) {
		$extension = strtolower( pathinfo( $name, PATHINFO_EXTENSION ) );
		$code_extensions = array( 'html', 'htm', 'css', 'scss', 'sass', 'less', 'js', 'jsx', 'ts', 'tsx', 'json', 'svg', 'xml', 'txt', 'md', 'php', 'yml', 'yaml', 'env', 'ini', 'conf', 'sql' );
		if ( in_array( $extension, $code_extensions, true ) && ! current_user_can( 'kodety_files_edit_code' ) ) {
			return new WP_Error( 'kodety_fs_edit_code_forbidden', __( 'Creating, uploading, or replacing editable code files requires the code-editing capability.', 'kodety-file-system' ), array( 'status' => 403 ) );
		}
		return true;
	}

	private function params( WP_REST_Request $request ): array {
		$params = $request->get_params();
		$json   = $request->get_json_params();
		return is_array( $json ) ? array_merge( $params, $json ) : $params;
	}

	private function normalize_files( array $params ): array {
		$files = array();
		foreach ( $params as $value ) {
			if ( ! is_array( $value ) ) { continue; }
			if ( isset( $value['tmp_name'] ) && is_array( $value['tmp_name'] ) ) {
				foreach ( $value['tmp_name'] as $index => $tmp ) {
					$files[] = array( 'tmp_name' => $tmp, 'name' => $value['name'][ $index ] ?? 'upload.bin', 'type' => $value['type'][ $index ] ?? '', 'size' => $value['size'][ $index ] ?? 0, 'error' => $value['error'][ $index ] ?? UPLOAD_ERR_OK );
				}
			} elseif ( isset( $value['tmp_name'] ) ) {
				$files[] = $value;
			}
		}
		return $files;
	}
}
