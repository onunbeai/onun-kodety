<?php

declare(strict_types=1);

namespace KodetyRocket\Optimization;

/** Keeps CSS strictly per-file: no @import combination and no data-URI embedding. */
final class ConservativeCssMinifier extends \KodetyRocketVendor\MatthiasMullie\Minify\CSS
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
