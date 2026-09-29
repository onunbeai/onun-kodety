<?php

/**
 * Isolated security regressions for the standalone Kodety File System.
 *
 * Run with: php Wordpress/tests/file-system-runtime.php
 */

define( 'ABSPATH', __DIR__ . '/' );
define( 'KB_IN_BYTES', 1024 );
define( 'MB_IN_BYTES', 1024 * 1024 );
define( 'GB_IN_BYTES', 1024 * MB_IN_BYTES );
define( 'KODETY_FS_REST_NAMESPACE', 'kodety-files/v1' );
define( 'KODETY_FS_ENABLE_DANGEROUS_FILE_EDITING', true );
define( 'MEDIA_TRASH', true );
define( 'EMPTY_TRASH_DAYS', 30 );

final class WP_Error {
	public function __construct(
		private string $code,
		private string $message = '',
		private mixed $data = null
	) {}
	public function get_error_code(): string { return $this->code; }
	public function get_error_message(): string { return $this->message; }
	public function get_error_data(): mixed { return $this->data; }
}

function __( string $message, string $domain = 'default' ): string { return $message; }
function is_wp_error( mixed $value ): bool { return $value instanceof WP_Error; }
function wp_normalize_path( string $path ): string { return str_replace( '\\', '/', $path ); }
function untrailingslashit( string $path ): string { return rtrim( $path, '/\\' ); }
function trailingslashit( string $path ): string { return rtrim( $path, '/\\' ) . '/'; }
function wp_basename( string $path ): string { return basename( str_replace( '\\', '/', $path ) ); }
function sanitize_file_name( string $name ): string {
	return trim( preg_replace( '/[^A-Za-z0-9._ -]+/', '', $name ) ?: '' );
}
function sanitize_key( string $key ): string {
	return preg_replace( '/[^a-z0-9_-]/', '', strtolower( $key ) ) ?: '';
}
function sanitize_text_field( string $value ): string { return trim( preg_replace( '/[\x00-\x1F\x7F]/', '', $value ) ?: '' ); }
function absint( mixed $value ): int { return abs( (int) $value ); }
$kodety_fs_test_filters = array();
function apply_filters( string $hook, mixed $value, mixed ...$args ): mixed {
	global $kodety_fs_test_filters;
	return array_key_exists( $hook, $kodety_fs_test_filters ) ? $kodety_fs_test_filters[ $hook ] : $value;
}
function wp_salt( string $scheme = 'auth' ): string { return hash( 'sha256', 'kodety-test-salt:' . $scheme ); }
function wp_upload_dir(): array { return array( 'basedir' => sys_get_temp_dir(), 'baseurl' => 'https://example.test/uploads' ); }
function wp_mkdir_p( string $path ): bool { return is_dir( $path ) || mkdir( $path, 0777, true ); }
$kodety_fs_test_denied_capabilities = array();
function current_user_can( string $capability ): bool {
	global $kodety_fs_test_denied_capabilities;
	return ! in_array( $capability, $kodety_fs_test_denied_capabilities, true );
}
function get_current_user_id(): int { return 1; }
function current_time( string $type, bool $gmt = false ): string { return gmdate( 'Y-m-d H:i:s' ); }
function rest_url( string $path = '' ): string { return 'https://example.test/wp-json/' . ltrim( $path, '/' ); }
function add_query_arg( array $args, string $url ): string { return $url . '?' . http_build_query( $args ); }
function wp_generate_uuid4(): string {
	$bytes = random_bytes( 16 );
	$bytes[6] = chr( ( ord( $bytes[6] ) & 0x0f ) | 0x40 );
	$bytes[8] = chr( ( ord( $bytes[8] ) & 0x3f ) | 0x80 );
	$hex = bin2hex( $bytes );
	return substr( $hex, 0, 8 ) . '-' . substr( $hex, 8, 4 ) . '-' . substr( $hex, 12, 4 ) . '-' . substr( $hex, 16, 4 ) . '-' . substr( $hex, 20 );
}
function wp_check_filetype( string $name ): array {
	$types = array( 'zip' => 'application/zip', 'txt' => 'text/plain', 'svg' => 'image/svg+xml' );
	$extension = strtolower( pathinfo( $name, PATHINFO_EXTENSION ) );
	return array( 'ext' => $extension, 'type' => $types[ $extension ] ?? false );
}
$kodety_fs_test_options = array();
function get_option( string $name, mixed $default = false ): mixed {
	global $kodety_fs_test_options;
	return $kodety_fs_test_options[ $name ] ?? $default;
}
function update_option( string $name, mixed $value, bool $autoload = false ): bool {
	global $kodety_fs_test_options;
	$kodety_fs_test_options[ $name ] = $value;
	return true;
}
$kodety_fs_test_media_status = array();
$kodety_fs_test_media_delete_calls = 0;
function get_post_status( int $id ): string {
	global $kodety_fs_test_media_status;
	return $kodety_fs_test_media_status[ $id ] ?? 'inherit';
}
function wp_delete_attachment( int $id, bool $force_delete = false ): object {
	global $kodety_fs_test_media_status, $kodety_fs_test_media_delete_calls;
	++$kodety_fs_test_media_delete_calls;
	$kodety_fs_test_media_status[ $id ] = 'trash';
	return (object) array( 'ID' => $id );
}

function kodety_fs_test_assert( bool $condition, string $message ): void {
	if ( $condition ) return;
	fwrite( STDERR, "FAIL: {$message}\n" );
	exit( 1 );
}

function kodety_fs_test_error_code( mixed $value ): string {
	return $value instanceof WP_Error ? $value->get_error_code() : '';
}

function kodety_fs_test_remove_tree( string $directory ): void {
	if ( ! is_dir( $directory ) ) return;
	$iterator = new RecursiveIteratorIterator(
		new RecursiveDirectoryIterator( $directory, FilesystemIterator::SKIP_DOTS ),
		RecursiveIteratorIterator::CHILD_FIRST
	);
	foreach ( $iterator as $item ) {
		if ( $item->isLink() || $item->isFile() ) unlink( $item->getPathname() );
		elseif ( $item->isDir() ) rmdir( $item->getPathname() );
	}
	rmdir( $directory );
}

$plugin_root = dirname( __DIR__ ) . '/kodety-file-system';
$guard_file = $plugin_root . '/includes/class-kodety-fs-path-guard.php';
if ( ! is_file( $guard_file ) ) {
	echo "Kodety File System backend not present yet; PHP runtime checks skipped.\n";
	exit( 0 );
}

require_once $guard_file;
kodety_fs_test_assert( class_exists( 'Kodety_FS_Path_Guard' ), 'PathGuard deve ser carregável sem Kodety Studio' );

$secret_box_file = $plugin_root . '/includes/class-kodety-fs-secret-box.php';
if ( is_file( $secret_box_file ) ) {
	require_once $secret_box_file;
	$sealed = Kodety_FS_Secret_Box::seal( 'remote-service-token' );
	kodety_fs_test_assert( 'remote-service-token' !== $sealed, 'token remoto não pode ser persistido em texto puro' );
	kodety_fs_test_assert( 'remote-service-token' === Kodety_FS_Secret_Box::open( $sealed ), 'token selado deve ser autenticado e recuperável' );
	$tampered = $sealed;
	$tampered[ strlen( $tampered ) - 2 ] = 'A' === $tampered[ strlen( $tampered ) - 2 ] ? 'B' : 'A';
	kodety_fs_test_assert( '' === Kodety_FS_Secret_Box::open( $tampered ), 'ciphertext adulterado deve ser recusado' );
}

$guard = new Kodety_FS_Path_Guard();
kodety_fs_test_assert( 'assets/brand/logo.svg' === $guard->normalize_relative( 'assets/brand/logo.svg', false ), 'caminho relativo seguro deve ser preservado' );
kodety_fs_test_assert( 'config/.env.production' === $guard->normalize_relative( 'config/.env.production', false ), '.env com sufixo seguro deve ser permitido como arquivo perigoso' );

foreach ( array(
	'../outside.php',
	'assets/../../outside.php',
	'%2e%2e/outside.php',
	'%252e%252e/outside.php',
	'%25252e%25252e/outside.php',
	'assets\\..\\outside.php',
	'assets%5c..%5coutside.php',
	'/etc/passwd',
	'C:\\Windows\\system.ini',
	'file:///etc/passwd',
	'.env/child.txt',
	"assets/evil\0.php",
) as $candidate ) {
	kodety_fs_test_assert(
		is_wp_error( $guard->normalize_relative( $candidate, false ) ),
		'PathGuard aceitou traversal/absoluto: ' . json_encode( $candidate )
	);
}

foreach ( array( '../evil.php', 'safe/evil.php', 'safe\\evil.php', '%2e%2e%2fevil.php', 'CON.txt', 'LPT1', 'name. ', '.gitignore', '.env.local.extra', '.env.bad suffix', "evil\0.php" ) as $candidate ) {
	kodety_fs_test_assert(
		is_wp_error( $guard->sanitize_name( $candidate ) ),
		'PathGuard aceitou nome inseguro: ' . json_encode( $candidate )
	);
}
kodety_fs_test_assert( 'brand logo.svg' === $guard->sanitize_name( 'brand logo.svg' ), 'nome seguro deve ser preservado' );
kodety_fs_test_assert( '.env' === $guard->sanitize_name( '.env' ), '.env estrito deve ser preservado' );
kodety_fs_test_assert( '.env.local' === $guard->sanitize_name( '.env.local' ), '.env com sufixo seguro deve ser preservado' );
kodety_fs_test_assert( $guard->is_dangerous_edit_name( '.env.local' ), '.env com sufixo deve sempre exigir permissão perigosa' );

$prefix_root = '/srv/kodety-storage/project-1';
kodety_fs_test_assert( $guard->is_within( $prefix_root, $prefix_root . '/assets/logo.svg' ), 'filho legítimo deve permanecer no mount' );
kodety_fs_test_assert( ! $guard->is_within( $prefix_root, $prefix_root . '-evil/assets/logo.svg' ), 'prefix collision não pode atravessar o mount' );

foreach ( array( 'payload.php', 'image.jpg.php', 'archive.phar', '.htaccess', '.user.ini', 'runner.sh', 'tool.exe' ) as $name ) {
	kodety_fs_test_assert( $guard->is_executable_public_name( $name ), "executável público aceito: {$name}" );
}
foreach ( array( 'photo.webp', 'movie.mp4', 'font.woff2', 'document.pdf', 'styles.css', 'app.js' ) as $name ) {
	kodety_fs_test_assert( ! $guard->is_executable_public_name( $name ), "asset público seguro bloqueado: {$name}" );
}
foreach ( array( 'page.html', 'legacy.xhtm', 'module.js', 'vector.svg', 'compressed.svgz', 'transform.xsl' ) as $name ) {
	kodety_fs_test_assert( $guard->is_active_public_name( $name ), "conteúdo público ativo não identificado: {$name}" );
}
foreach ( array( 'photo.webp', 'document.pdf', 'styles.css', 'data.json' ) as $name ) {
	kodety_fs_test_assert( ! $guard->is_active_public_name( $name ), "asset público inerte classificado como ativo: {$name}" );
}

$safe_svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>';
kodety_fs_test_assert( $safe_svg === $guard->sanitize_svg( $safe_svg ), 'SVG inerte deve ser aceito' );
foreach ( array(
	'<svg><script>alert(1)</script></svg>',
	'<svg><foreignObject><iframe src="https://evil.test"></iframe></foreignObject></svg>',
	'<svg><image href="javascript:alert(1)"/></svg>',
	'<svg onload="alert(1)"></svg>',
	'<svg><use href="https://evil.test/icon.svg#x"/></svg>',
) as $svg ) {
	kodety_fs_test_assert( is_wp_error( $guard->sanitize_svg( $svg ) ), 'SVG ativo/externo deve ser recusado' );
}

$runtime_root = sys_get_temp_dir() . '/kodety-fs-runtime-' . bin2hex( random_bytes( 6 ) );
$mount_root   = $runtime_root . '/mount';
$outside_root = $runtime_root . '/outside';
mkdir( $mount_root . '/safe', 0777, true );
mkdir( $outside_root, 0777, true );
file_put_contents( $mount_root . '/safe/file.txt', 'safe' );
file_put_contents( $outside_root . '/secret.txt', 'outside' );
register_shutdown_function( static fn(): mixed => kodety_fs_test_remove_tree( $runtime_root ) );

$resolved = $guard->resolve( $mount_root, 'safe/file.txt', true );
kodety_fs_test_assert( is_string( $resolved ) && realpath( $resolved ) === realpath( $mount_root . '/safe/file.txt' ), 'arquivo real dentro do mount deve resolver' );
$future = $guard->resolve( $mount_root, 'safe/future.txt', false );
kodety_fs_test_assert( is_string( $future ) && str_ends_with( wp_normalize_path( $future ), '/safe/future.txt' ), 'novo filho seguro deve resolver pelo pai real' );

if ( function_exists( 'symlink' ) && @symlink( $outside_root, $mount_root . '/escape' ) ) {
	$escaped = $guard->resolve( $mount_root, 'escape/secret.txt', true );
	kodety_fs_test_assert( 'kodety_fs_symlink' === kodety_fs_test_error_code( $escaped ), 'symlink intermediário deve ser recusado antes de alcançar arquivo externo' );
}

if ( function_exists( 'link' ) && @link( $mount_root . '/safe/file.txt', $mount_root . '/safe/alias.txt' ) ) {
	$hardlink = $guard->resolve( $mount_root, 'safe/alias.txt', true );
	kodety_fs_test_assert( 'kodety_fs_hardlink' === kodety_fs_test_error_code( $hardlink ), 'hard link deve ser recusado' );
}

// Providers are loaded and exercised as soon as their implementation exists.
// Keeping the guard suite independent lets this test run during parallel build
// work without masking failures after the provider file is committed.
if ( ! class_exists( 'Kodety_FS_Database' ) ) {
	final class Kodety_FS_Database {
		public function asset_key( string $provider, string $mount, string $path ): string { return hash( 'sha256', $provider . "\n" . $mount . "\n" . $path ); }
		public function metadata( string $asset_key ): array { return array( 'favorite' => false, 'tags' => array() ); }
		public function asset_by_key( string $asset_key ): ?array { return null; }
		public function upsert_asset( array $item ): void {}
		public function add_activity( string $action, string $provider, string $mount, string $path, mixed $before = null, mixed $after = null ): bool { return true; }
		public function trash_item( string $uuid ): ?array { return null; }
	}
}
$provider_file = $plugin_root . '/includes/class-kodety-fs-local-provider.php';
if ( is_file( $provider_file ) ) {
	$private_root = $runtime_root . '/shared-storage';
	mkdir( $private_root, 0777, true );
	if ( ! defined( 'KODETY_FS_STORAGE_ROOT' ) ) define( 'KODETY_FS_STORAGE_ROOT', $private_root );
	if ( ! defined( 'KODETY_FS_PRIVATE_ROOT' ) ) define( 'KODETY_FS_PRIVATE_ROOT', $private_root );
	$interface_file = $plugin_root . '/includes/interface-kodety-fs-storage-provider.php';
	require_once $interface_file;
	require_once $provider_file;
	kodety_fs_test_assert( class_exists( 'Kodety_FS_Local_Provider' ), 'Local provider deve carregar isoladamente' );
	kodety_fs_test_assert( is_subclass_of( 'Kodety_FS_Local_Provider', 'Kodety_FS_Storage_Provider' ), 'Local provider deve cumprir o contrato StorageProvider' );
	$legacy_root_deny = "# Kodety File System\n<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n";
	$legacy_root_webconfig = '<?xml version="1.0" encoding="UTF-8"?><configuration><system.webServer><security><authorization><remove users="*" roles="" verbs=""/><add accessType="Deny" users="*"/></authorization></security></system.webServer></configuration>';
	file_put_contents( $private_root . '/.htaccess', $legacy_root_deny );
	file_put_contents( $private_root . '/web.config', $legacy_root_webconfig );
	Kodety_FS_Local_Provider::initialize_storage();
	clearstatcache( true, $private_root );
	kodety_fs_test_assert( Kodety_FS_Local_Provider::private_storage_available(), 'raiz privada externa e gravável deve ser habilitada' );
	kodety_fs_test_assert( 0755 === ( fileperms( $private_root ) & 0777 ), 'raiz compartilhada deve continuar atravessável para servir public/' );
	kodety_fs_test_assert( ! file_exists( $private_root . '/.htaccess' ) && ! file_exists( $private_root . '/web.config' ), 'raiz compartilhada não pode herdar deny privado' );
	kodety_fs_test_assert( is_file( $private_root . '/projects/default/.htaccess' ) && is_file( $private_root . '/imports/.htaccess' ), 'subdiretórios privados devem ser protegidos individualmente' );
	$custom_root_deny = "# custom owner rule\nRequire all denied\n";
	file_put_contents( $private_root . '/.htaccess', $custom_root_deny );
	Kodety_FS_Local_Provider::initialize_storage();
	kodety_fs_test_assert( $custom_root_deny === file_get_contents( $private_root . '/.htaccess' ), 'migração não pode apagar configuração root customizada' );
	$shared_health = Kodety_FS_Local_Provider::storage_health();
	kodety_fs_test_assert( 'degraded' === $shared_health['status'] && in_array( '.htaccess', $shared_health['sharedRootProtectionConflict']['files'], true ), 'deny customizado preservado deve aparecer no storage health' );
	unlink( $private_root . '/.htaccess' );

	$provider = new Kodety_FS_Local_Provider( new Kodety_FS_Database(), $guard );
	$reservation_id = '11111111-1111-4111-8111-111111111111';
	$reservation_dir = $private_root . '/uploads/' . $reservation_id;
	mkdir( $reservation_dir, 0777, true );
	file_put_contents( $reservation_dir . '/meta.json', json_encode( array( 'size' => 100, 'userId' => 5, 'chunkSize' => 10, 'chunks' => 10, 'received' => array( '9' => 10 ) ) ) );
	$sparse_payload = fopen( $reservation_dir . '/payload.part', 'c+b' );
	fseek( $sparse_payload, 90 );
	fwrite( $sparse_payload, str_repeat( 'x', 10 ) );
	fclose( $sparse_payload );
	clearstatcache( true, $reservation_dir . '/payload.part' );
	$reservations = $provider->upload_reservation_usage();
	kodety_fs_test_assert( is_array( $reservations ) && 100 === $reservations['reservedBytes'] && 90 === $reservations['outstandingBytes'] && 1 === $reservations['byUser'][5]['sessions'], 'allocator deve somar meta.received; filesize esparso do último chunk não pode zerar outstandingBytes' );
	$excluded_reservations = $provider->upload_reservation_usage( $reservation_id );
	kodety_fs_test_assert( is_array( $excluded_reservations ) && 1 === $excluded_reservations['sessions'] && 100 === $excluded_reservations['reservedBytes'], 'allocator não pode excluir uma reserva ainda incompleta' );
	$capacity = new ReflectionMethod( $provider, 'ensure_capacity' );
	$capacity->setAccessible( true );
	kodety_fs_test_assert( true === $capacity->invoke( $provider, 0, $private_root . '/private/probe.bin', 0 ), 'capacity guard deve adquirir lock e aceitar mutação sem crescimento' );
	$provider_source = file_get_contents( $provider_file );
	$capacity_source = substr( $provider_source, strpos( $provider_source, 'private function ensure_capacity' ) );
	$reservation_snapshot_position = strpos( $capacity_source, 'upload_reservation_usage' );
	$disk_snapshot_position = strpos( $capacity_source, 'disk_free_space' );
	kodety_fs_test_assert( false !== $reservation_snapshot_position && false !== $disk_snapshot_position && $reservation_snapshot_position < $disk_snapshot_position, 'capacity deve medir outstanding antes do disco para não perder chunk concorrente entre snapshots' );
	$managed_usage_method = new ReflectionMethod( $provider, 'managed_storage_usage' );
	$managed_usage_method->setAccessible( true );
	$managed_usage = $managed_usage_method->invoke( $provider );
	global $kodety_fs_test_filters;
	$kodety_fs_test_filters['kodety_fs_storage_quota_bytes'] = $managed_usage['bytes'] + 109;
	$quota_blocked = $provider->check_storage_capacity( 10, $private_root . '/private/quota.bin', 10 );
	kodety_fs_test_assert( 'kodety_fs_storage_quota' === kodety_fs_test_error_code( $quota_blocked ), 'quota lógica deve incluir reservas ativas além do uso já persistido' );

	$complete_id = '22222222-2222-4222-8222-222222222222';
	$complete_dir = $private_root . '/uploads/' . $complete_id;
	mkdir( $complete_dir, 0777, true );
	file_put_contents( $complete_dir . '/meta.json', json_encode( array( 'size' => 10, 'userId' => 5, 'chunkSize' => 10, 'chunks' => 1, 'received' => array( '0' => 10 ) ) ) );
	file_put_contents( $complete_dir . '/payload.part', str_repeat( 'y', 10 ) );
	$complete_exclusion = $provider->upload_reservation_usage( $complete_id );
	kodety_fs_test_assert( is_array( $complete_exclusion ) && 1 === $complete_exclusion['sessions'] && 100 === $complete_exclusion['reservedBytes'], 'allocator deve excluir somente a reserva completa indicada e preservar as demais' );
	$kodety_fs_test_filters['kodety_fs_storage_quota_bytes'] = $managed_usage['bytes'] + 110;
	$completed_import = $provider->import_path( $complete_dir . '/payload.part', 'private', '', 'completed.txt' );
	kodety_fs_test_assert( is_array( $completed_import ) && 'completed.txt' === $completed_import['path'], 'commit deve excluir a própria reserva e contar o crescimento uma única vez' );
	unset( $kodety_fs_test_filters['kodety_fs_storage_quota_bytes'] );
	$environment_file = $provider->write( array( 'mount' => 'private', 'path' => '.env.local', 'content' => "SECRET=test\n" ) );
	kodety_fs_test_assert( is_array( $environment_file ) && '.env.local' === $environment_file['name'], '.env autorizado deve ser gravável apenas no mount protegido' );
	$private_listing = $provider->list( array( 'mount' => 'private', 'path' => '' ) );
	$listed_names = is_array( $private_listing ) ? array_column( $private_listing['items'], 'name' ) : array();
	kodety_fs_test_assert( in_array( '.env.local', $listed_names, true ), '.env autorizado deve aparecer na listagem protegida' );
	$public_environment = $provider->write( array( 'mount' => 'public', 'path' => '.env', 'content' => "SECRET=public\n" ) );
	kodety_fs_test_assert( 'kodety_fs_dangerous_edit_disabled' === kodety_fs_test_error_code( $public_environment ), '.env nunca pode ser gravado no mount público' );
	$restore = $provider->restore_trash( '00000000-0000-4000-8000-000000000000' );
	kodety_fs_test_assert( 'kodety_fs_trash_not_found' === kodety_fs_test_error_code( $restore ), 'restore deve executar sob lock e recusar índice inexistente' );
	file_put_contents( $private_root . '/private/source.txt', 'archive integrity' );
	$archive = $provider->compress( array( array( 'mount' => 'private', 'path' => 'source.txt' ) ), 'private', 'bundle.zip' );
	if ( class_exists( 'ZipArchive' ) ) {
		kodety_fs_test_assert( is_array( $archive ) && 'bundle.zip' === $archive['path'] && is_file( $private_root . '/private/bundle.zip' ), 'compress deve finalizar e verificar o ZIP em staging antes do commit: ' . ( is_wp_error( $archive ) ? $archive->get_error_code() . ' ' . $archive->get_error_message() : json_encode( $archive ) ) );
		$code_zip_path = $private_root . '/private/code.zip';
		$code_zip = new ZipArchive();
		$code_zip->open( $code_zip_path, ZipArchive::CREATE | ZipArchive::OVERWRITE );
		$code_zip->addFromString( 'app.js', 'alert(1)' );
		$code_zip->close();
		global $kodety_fs_test_denied_capabilities;
		$kodety_fs_test_denied_capabilities = array( 'kodety_files_edit_code' );
		$blocked_extract = $provider->extract( 'private', 'code.zip', 'expanded' );
		file_put_contents( $private_root . '/private/source.js', 'alert(1)' );
		$blocked_copy = $provider->copy( array( 'mount' => 'private', 'path' => 'source.js', 'toMount' => 'private', 'toPath' => 'renamed.txt' ) );
		$kodety_fs_test_denied_capabilities = array();
		kodety_fs_test_assert( 'kodety_fs_code_edit_forbidden' === kodety_fs_test_error_code( $blocked_extract ), 'ZIP não pode materializar código sem kodety_files_edit_code' );
		kodety_fs_test_assert( 'kodety_fs_code_edit_forbidden' === kodety_fs_test_error_code( $blocked_copy ), 'copy/rename não pode ocultar extensão de origem para contornar edit_code' );
	} else {
		kodety_fs_test_assert( 'kodety_fs_zip_unavailable' === kodety_fs_test_error_code( $archive ), 'compress deve falhar explicitamente sem ZipArchive' );
	}
}

$media_provider_file = $plugin_root . '/includes/class-kodety-fs-wordpress-media-provider.php';
if ( is_file( $media_provider_file ) ) {
	require_once $plugin_root . '/includes/interface-kodety-fs-storage-provider.php';
	require_once $media_provider_file;
	$media = new Kodety_FS_WordPress_Media_Provider();
	global $kodety_fs_test_media_status, $kodety_fs_test_media_delete_calls;
	$kodety_fs_test_media_status[77] = 'trash';
	$before_delete_calls = $kodety_fs_test_media_delete_calls;
	$already_trashed = $media->delete( array( 'id' => 'wp-media:77' ) );
	kodety_fs_test_assert( is_array( $already_trashed ) && ! empty( $already_trashed['trashed'] ) && $before_delete_calls === $kodety_fs_test_media_delete_calls, 'delete repetido em mídia já no trash deve ser idempotente e não chamar wp_delete_attachment' );
	$kodety_fs_test_media_status[78] = 'inherit';
	$first_delete = $media->delete( array( 'id' => 'wp-media:78' ) );
	$after_first_delete = $kodety_fs_test_media_delete_calls;
	$second_delete = $media->delete( array( 'id' => 'wp-media:78' ) );
	kodety_fs_test_assert( is_array( $first_delete ) && is_array( $second_delete ) && $after_first_delete === $kodety_fs_test_media_delete_calls, 'segunda exclusão normal de mídia não pode converter trash em purge permanente' );
}

$remote_provider_file = $plugin_root . '/includes/class-kodety-fs-remote-provider.php';
if ( is_file( $remote_provider_file ) ) {
	$interface_file = $plugin_root . '/includes/interface-kodety-fs-storage-provider.php';
	require_once $interface_file;
	require_once $remote_provider_file;
	$remote = new Kodety_FS_Remote_Provider( array() );
	$translate = new ReflectionMethod( $remote, 'provider_request_data' );
	$translate->setAccessible( true );
	$first = $translate->invoke( $remote, array( 'mount' => 'remote', 'storageMount' => 'project-one', 'path' => 'assets/logo.svg' ) );
	$second = $translate->invoke( $remote, array( 'mount' => 'remote', 'storageMount' => 'project-two', 'path' => 'assets/logo.svg' ) );
	kodety_fs_test_assert( 'project-one' === $first['mount'], 'primeiro mount remoto deve preservar seu locator real' );
	kodety_fs_test_assert( 'project-two' === $second['mount'], 'segundo mount remoto com o mesmo path não pode colidir com o primeiro' );
	kodety_fs_test_assert( $first['path'] === $second['path'] && $first['mount'] !== $second['mount'], 'mount real deve desambiguar paths remotos iguais' );
	kodety_fs_test_assert( ! isset( $first['storageMount'] ), 'alias virtual não deve atravessar a fronteira do provider remoto' );
	$root_listing = $translate->invoke( $remote, array( 'mount' => 'remote', 'path' => '' ) );
	kodety_fs_test_assert( ! isset( $root_listing['mount'] ), 'listagem remota sem locator real deve omitir o mount virtual' );
	$same_mount_move = $translate->invoke( $remote, array( 'mount' => 'remote', 'storageMount' => 'project-one', 'toMount' => 'remote', 'path' => 'assets/logo.svg', 'toPath' => 'assets/logo-new.svg' ) );
	kodety_fs_test_assert( 'project-one' === $same_mount_move['mount'] && 'project-one' === $same_mount_move['toMount'], 'destino virtual de rename/duplicate deve herdar o mount real da origem' );
	foreach ( array( '../outside.txt', '%2e%2e/outside.txt', 'safe\\..\\outside.txt', "safe/control\0.txt" ) as $unsafe_remote_path ) {
		$unsafe = $translate->invoke( $remote, array( 'mount' => 'remote', 'storageMount' => 'project-one', 'path' => $unsafe_remote_path ) );
		kodety_fs_test_assert( is_wp_error( $unsafe ), 'locator remoto inseguro deve ser recusado antes da assinatura: ' . json_encode( $unsafe_remote_path ) );
	}
	foreach ( array( '../evil.php', 'safe/evil.php', 'safe\\evil.php', '..', 'web.config', "evil\0.php" ) as $unsafe_remote_name ) {
		$unsafe = $translate->invoke( $remote, array( 'mount' => 'remote', 'storageMount' => 'project-one', 'path' => 'assets', 'name' => $unsafe_remote_name ) );
		kodety_fs_test_assert( is_wp_error( $unsafe ), 'nome remoto inseguro deve ser recusado antes da assinatura: ' . json_encode( $unsafe_remote_name ) );
	}
	$safe_remote_name = $translate->invoke( $remote, array( 'mount' => 'remote', 'storageMount' => 'project-one', 'path' => 'assets', 'name' => 'brand logo.svg' ) );
	kodety_fs_test_assert( 'brand logo.svg' === $safe_remote_name['name'], 'nome remoto seguro deve ser preservado antes da assinatura' );
}

echo "Kodety File System PHP security runtime passed.\n";
