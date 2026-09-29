<?php

namespace Kodefy\Shopify;

defined('ABSPATH') || exit;

final class Kodefy_Theme_Exporter {
    private string $root;

    public function __construct(string $root) {
        $this->root = rtrim(str_replace('\\', '/', $root), '/');
    }

    public function kit_zip(): string {
        return $this->package_directory($this->root . '/kit', 'kodefy-kodety-kit-');
    }

    private function package_directory(string $source, string $prefix): string {
        if (!class_exists('ZipArchive')) throw new \RuntimeException('A extensão PHP ZipArchive precisa estar habilitada.');
        if (!is_dir($source)) throw new \RuntimeException('Os arquivos do pacote Kodefy não foram encontrados.');
        $temporary = wp_tempnam($prefix . '.zip');
        if (!is_string($temporary) || $temporary === '') throw new \RuntimeException('Não foi possível criar o arquivo temporário.');
        $zip = new \ZipArchive();
        if ($zip->open($temporary, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
            @unlink($temporary);
            throw new \RuntimeException('Não foi possível criar o ZIP.');
        }
        try {
            $iterator = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($source, \FilesystemIterator::SKIP_DOTS),
                \RecursiveIteratorIterator::LEAVES_ONLY
            );
            foreach ($iterator as $file) {
                if (!$file instanceof \SplFileInfo || !$file->isFile() || $file->isLink()) continue;
                $absolute = str_replace('\\', '/', $file->getPathname());
                $relative = ltrim(substr($absolute, strlen(rtrim($source, '/'))), '/');
                if ($relative === '' || str_contains($relative, '..')) continue;
                if (!$zip->addFile($absolute, $relative)) throw new \RuntimeException('Falha ao incluir ' . $relative . ' no ZIP.');
            }
            $zip->setArchiveComment('Kodefy for Kodety ' . VERSION);
        } finally {
            $zip->close();
        }
        if (!is_file($temporary) || filesize($temporary) <= 0) {
            @unlink($temporary);
            throw new \RuntimeException('O ZIP foi gerado sem conteúdo.');
        }
        return $temporary;
    }

}
