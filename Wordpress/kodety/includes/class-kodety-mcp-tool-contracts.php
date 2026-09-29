<?php

defined('ABSPATH') || exit;

/** Machine-readable contracts for the original MCP tools. Native operations
 * share their separate registry with the in-product Agent. */
final class Kodety_MCP_Tool_Contracts {
    public static function schema(string $tool): array {
        $string = ['type' => 'string'];
        $text = $string + ['maxLength' => 4194304];
        $path = $string + ['minLength' => 1, 'description' => 'Relative authored project path, never an absolute path or kodety-build output.'];
        $revision = ['type' => 'integer', 'minimum' => 0, 'description' => 'workspaceRevision returned by the latest project read. A stale revision is rejected.'];
        $id = ['type' => 'integer', 'minimum' => 1];
        $boolean = ['type' => 'boolean'];
        $query = ['search' => $string, 'limit' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 100]];
        $content = [
            'id' => $id, 'postType' => $string, 'title' => $string, 'content' => $text,
            'excerpt' => $text, 'slug' => $string,
            'status' => ['type' => 'string', 'enum' => ['draft', 'pending', 'private', 'future', 'publish'], 'description' => 'New content defaults to draft. Publishing requires the user to request it.'],
            'meta' => ['type' => 'object', 'additionalProperties' => true],
        ];
        $fields = ['type' => 'array', 'maxItems' => 80, 'items' => ['type' => 'object', 'required' => ['name', 'type'], 'properties' => [
            'name' => $string, 'label' => $string, 'description' => $string,
            'type' => ['type' => 'string', 'enum' => ['text', 'textarea', 'richtext', 'image', 'url', 'number', 'boolean', 'date', 'color']],
            'required' => $boolean, 'default' => ['type' => ['string', 'number', 'boolean', 'null', 'array', 'object']], 'min' => ['type' => 'number'], 'max' => ['type' => 'number'],
            'step' => ['type' => 'number', 'exclusiveMinimum' => 0], 'unit' => $string,
        ], 'additionalProperties' => false]];
        [$required, $properties] = match ($tool) {
            'get_site', 'get_settings', 'list_collections', 'get_ai_status', 'publish' => [[], []],
            'update_settings' => [[], ['editorCornerIcon' => ['type' => 'string', 'enum' => ['kodety-logo', 'client-logo']], 'interfaceAccentColor' => $string]],
            'list_files' => [[], ['path' => $string]],
            'read_file' => [['path'], ['path' => $path]],
            'write_file' => [['path', 'content', 'baseRevision'], ['path' => $path, 'content' => $string + ['maxLength' => 34952544], 'encoding' => ['type' => 'string', 'enum' => ['utf8', 'base64']], 'baseRevision' => $revision]],
            'replace_in_file' => [['path', 'search', 'replacement', 'baseRevision'], ['path' => $path, 'search' => $text + ['minLength' => 1], 'replacement' => $text, 'replaceAll' => $boolean, 'baseRevision' => $revision]],
            'delete_file' => [['path', 'baseRevision'], ['path' => $path, 'baseRevision' => $revision]],
            'list_content' => [[], $query + ['postType' => $string, 'status' => $string]],
            'get_content', 'delete_content' => [['id'], ['id' => $id] + ($tool === 'delete_content' ? ['force' => $boolean] : [])],
            'upsert_content' => [[], $content],
            'create_collection' => [['name'], ['name' => $string, 'singular' => $string, 'slug' => $string, 'fields' => $fields]],
            'update_collection_fields' => [['postType', 'fields'], ['postType' => $string, 'fields' => $fields]],
            'list_media' => [[], $query],
            'upload_media' => [['filename', 'base64'], ['filename' => $string, 'base64' => $string + ['maxLength' => 34952544], 'title' => $string, 'alt' => $string, 'projectPath' => $path, 'baseRevision' => $revision]],
            'generate_ai_content' => [['prompt'], ['prompt' => $string + ['minLength' => 1, 'maxLength' => 12000], 'task' => ['type' => 'string', 'enum' => ['article', 'title', 'description', 'excerpt', 'seo', 'schema', 'social', 'rewrite', 'translation']], 'context' => $text, 'language' => $string, 'tone' => $string]],
            'native_catalog' => [[], ['area' => $string + ['description' => 'Optional operation prefix, for example cms, localization or ai_settings.']]],
            'native_call' => [['operation', 'arguments'], ['operation' => $string + ['minLength' => 1], 'arguments' => ['type' => 'object', 'additionalProperties' => true, 'description' => 'Exact arguments from the operation inputSchema returned by kodety_native_catalog.']]],
            default => throw new InvalidArgumentException('Unknown MCP tool contract: ' . $tool),
        };
        if (in_array($tool, ['list_content', 'get_content', 'upsert_content', 'delete_content', 'list_collections', 'create_collection', 'update_collection_fields'], true)) {
            $properties['context'] = ['type' => 'object', 'description' => 'Native editor lease context from kodety_native_catalog.', 'additionalProperties' => true];
            if (in_array($tool, ['upsert_content', 'delete_content', 'create_collection', 'update_collection_fields'], true)) {
                $properties['expectedRevision'] = ['type' => 'string', 'minLength' => 1, 'description' => 'CMS item revision for update/delete, CMS schema revision for create/fields. Read native CMS first.'];
                $required[] = 'expectedRevision';
            }
            if ($tool === 'list_content') $properties['page'] = ['type' => 'integer', 'minimum' => 1];
        }
        $schema = ['type' => 'object', 'properties' => $properties ?: new stdClass(), 'additionalProperties' => false];
        if ($required) $schema['required'] = $required;
        return $schema;
    }
}
