<?php

defined( 'ABSPATH' ) || exit;

interface Kodety_FS_Storage_Provider {
	public function get_id(): string;

	public function get_label(): string;

	/** @return array<string,bool> */
	public function get_capabilities(): array;

	/** @return array<string,mixed>|WP_Error */
	public function list( array $args );

	/** @return array<string,mixed>|WP_Error */
	public function stat( array $args );

	/** @return string|WP_Error */
	public function read( array $args );

	/** @return array<string,mixed>|WP_Error */
	public function write( array $args );

	/** @return array<string,mixed>|WP_Error */
	public function upload( array $file, array $args );

	/** @return array<string,mixed>|WP_Error */
	public function delete( array $args );

	/** @return array<string,mixed>|WP_Error */
	public function get_url( array $args );
}

