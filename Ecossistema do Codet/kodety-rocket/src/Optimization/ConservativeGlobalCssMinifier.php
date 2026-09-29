<?php

declare(strict_types=1);

namespace KodetyRocket\Optimization;

/** Development-only equivalent for an explicitly enabled global vendor tree. */
final class ConservativeGlobalCssMinifier extends \MatthiasMullie\Minify\CSS
{
    /** @param mixed $source
     *  @param mixed $content
     *  @param mixed $parents
     *  @return mixed
     */
    protected function combineImports($source, $content, $parents)
    {
        return $content;
    }

    /** @param mixed $source
     *  @param mixed $content
     *  @return mixed
     */
    protected function importFiles($source, $content)
    {
        return $content;
    }
}
