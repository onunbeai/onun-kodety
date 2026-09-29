<?php

declare(strict_types=1);

namespace KodetyRocket\Optimization;

use KodetyRocket\Diagnostics\Logger;

/** Runs HTML transformations in an explicit, deterministic order. */
final class Pipeline
{
    private Logger $logger;

    /** @var array<int, list<callable(string): string>> */
    private array $transformers = [];

    public function __construct(Logger $logger)
    {
        $this->logger = $logger;
    }

    /** @param callable(string): string $transformer */
    public function add(callable $transformer, int $priority = 10): self
    {
        $this->transformers[$priority][] = $transformer;

        return $this;
    }

    public function process(string $html): string
    {
        if ($html === '' || $this->transformers === []) {
            return $html;
        }

        ksort($this->transformers, SORT_NUMERIC);
        $current = $html;

        foreach ($this->transformers as $priority => $transformers) {
            foreach ($transformers as $transformer) {
                try {
                    $candidate = $transformer($current);
                    if (is_string($candidate) && $candidate !== '') {
                        $current = $candidate;
                    }
                } catch (\Throwable $exception) {
                    $this->logger->warning('HTML transformer failed open.', [
                        'priority' => $priority,
                        'transformer' => $this->nameOf($transformer),
                        'exception' => $exception,
                    ]);
                }
            }
        }

        return $current;
    }

    /** @param callable $transformer */
    private function nameOf(callable $transformer): string
    {
        if (is_object($transformer)) {
            return get_class($transformer);
        }

        if (is_array($transformer)) {
            $owner = is_object($transformer[0] ?? null) ? get_class($transformer[0]) : (string) ($transformer[0] ?? 'callable');

            return $owner . '::' . (string) ($transformer[1] ?? '__invoke');
        }

        return is_string($transformer) ? $transformer : 'closure';
    }
}
