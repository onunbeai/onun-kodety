<?php

declare(strict_types=1);

namespace KodetyRocket\Cache;

use Throwable;

/**
 * Maps WordPress content changes to safe cache purges.
 *
 * Automatic hooks are conservative by default because a post can affect home,
 * archives, feeds, menus and widgets. Selective URL/tag APIs remain available
 * to callers that have complete dependency information.
 */
final class CacheInvalidator
{
    public const RETRY_SITE_HOOK = 'kodety_rocket_retry_site_cache_purge';
    public const RETRY_NETWORK_HOOK = 'kodety_rocket_retry_network_cache_purge';
    public const PENDING_OPTION = 'kodety_rocket_cache_purge_pending';
    public const NETWORK_PENDING_OPTION = 'kodety_rocket_cache_network_purge_pending';
    public const NETWORK_RETRY_LOCK_OPTION = 'kodety_rocket_cache_network_retry_lock_v2';
    public const SITE_GENERATION_OPTION = 'kodety_rocket_cache_generation_v2';
    public const NETWORK_GENERATION_OPTION = 'kodety_rocket_network_version';

    private FileCacheStore $store;

    /** @var list<string> */
    private array $ignoredQueryParameters;

    /** @var list<string> */
    private array $allowedQueryParameters;

    private mixed $logger;
    private bool $conservativeHooks;
    private bool $registered = false;

    private ?string $networkRetryLockValue = null;
    private bool $networkRetryLockUsesSiteOption = true;

    /**
     * @param list<string> $ignoredQueryParameters
     * @param list<string> $allowedQueryParameters
     */
    public function __construct(
        FileCacheStore $store,
        array $ignoredQueryParameters = [],
        array $allowedQueryParameters = [],
        mixed $logger = null,
        bool $conservativeHooks = true,
    ) {
        $this->store = $store;
        $this->ignoredQueryParameters = $ignoredQueryParameters;
        $this->allowedQueryParameters = $allowedQueryParameters;
        $this->logger = $logger;
        $this->conservativeHooks = $conservativeHooks;
    }

    public function registerHooks(): void
    {
        if ($this->registered || ! function_exists('add_action')) {
            return;
        }

        add_action('save_post', [$this, 'onSavePost'], 20, 3);
        add_action('before_delete_post', [$this, 'onPostRemoved'], 20, 2);
        add_action('trashed_post', [$this, 'onPostRemoved'], 20, 2);
        add_action('untrashed_post', [$this, 'onPostRemoved'], 20, 2);
        add_action('added_post_meta', [$this, 'onPostMetaChanged'], 20, 4);
        add_action('updated_post_meta', [$this, 'onPostMetaChanged'], 20, 4);
        add_action('deleted_post_meta', [$this, 'onPostMetaChanged'], 20, 4);
        add_action('set_object_terms', [$this, 'onObjectTermsChanged'], 20, 6);

        add_action('created_term', [$this, 'onTermChanged'], 20, 3);
        add_action('edited_term', [$this, 'onTermChanged'], 20, 3);
        add_action('delete_term', [$this, 'onTermDeleted'], 20, 5);
        add_action('transition_comment_status', [$this, 'onCommentTransition'], 20, 3);
        add_action('comment_post', [$this, 'onCommentCreated'], 20, 3);
        add_action('edit_comment', [$this, 'onCommentEdited'], 20, 2);
        add_action('profile_update', [$this, 'onUserChanged'], 20, 2);
        add_action('user_register', [$this, 'onUserChanged'], 20, 2);
        add_action('deleted_user', [$this, 'onUserChanged'], 20, 3);

        add_action('wp_update_nav_menu', [$this, 'onGlobalFrontendChange'], 20, 1);
        add_action('customize_save_after', [$this, 'onGlobalFrontendChange'], 20, 1);
        add_action('switch_theme', [$this, 'onGlobalFrontendChange'], 20, 3);
        add_action('upgrader_process_complete', [$this, 'onUpgradeComplete'], 20, 2);
        add_action('activated_plugin', [$this, 'onPluginStateChanged'], 20, 2);
        add_action('deactivated_plugin', [$this, 'onPluginStateChanged'], 20, 2);
        add_action('updated_option', [$this, 'onOptionUpdated'], 20, 3);
        add_action(self::RETRY_SITE_HOOK, [$this, 'retrySitePurge'], 10, 1);
        add_action(self::RETRY_NETWORK_HOOK, [$this, 'retryNetworkPurge'], 10, 0);

        foreach ($this->frontendOptions() as $option) {
            add_action('update_option_' . $option, [$this, 'onGlobalFrontendChange'], 20, 3);
        }

        $this->registered = true;
        $this->schedulePendingRetries();
    }

    public function unregisterHooks(): void
    {
        if (! $this->registered || ! function_exists('remove_action')) {
            return;
        }

        remove_action('save_post', [$this, 'onSavePost'], 20);
        remove_action('before_delete_post', [$this, 'onPostRemoved'], 20);
        remove_action('trashed_post', [$this, 'onPostRemoved'], 20);
        remove_action('untrashed_post', [$this, 'onPostRemoved'], 20);
        remove_action('added_post_meta', [$this, 'onPostMetaChanged'], 20);
        remove_action('updated_post_meta', [$this, 'onPostMetaChanged'], 20);
        remove_action('deleted_post_meta', [$this, 'onPostMetaChanged'], 20);
        remove_action('set_object_terms', [$this, 'onObjectTermsChanged'], 20);
        remove_action('created_term', [$this, 'onTermChanged'], 20);
        remove_action('edited_term', [$this, 'onTermChanged'], 20);
        remove_action('delete_term', [$this, 'onTermDeleted'], 20);
        remove_action('transition_comment_status', [$this, 'onCommentTransition'], 20);
        remove_action('comment_post', [$this, 'onCommentCreated'], 20);
        remove_action('edit_comment', [$this, 'onCommentEdited'], 20);
        remove_action('profile_update', [$this, 'onUserChanged'], 20);
        remove_action('user_register', [$this, 'onUserChanged'], 20);
        remove_action('deleted_user', [$this, 'onUserChanged'], 20);
        remove_action('wp_update_nav_menu', [$this, 'onGlobalFrontendChange'], 20);
        remove_action('customize_save_after', [$this, 'onGlobalFrontendChange'], 20);
        remove_action('switch_theme', [$this, 'onGlobalFrontendChange'], 20);
        remove_action('upgrader_process_complete', [$this, 'onUpgradeComplete'], 20);
        remove_action('activated_plugin', [$this, 'onPluginStateChanged'], 20);
        remove_action('deactivated_plugin', [$this, 'onPluginStateChanged'], 20);
        remove_action('updated_option', [$this, 'onOptionUpdated'], 20);
        remove_action(self::RETRY_SITE_HOOK, [$this, 'retrySitePurge'], 10);
        remove_action(self::RETRY_NETWORK_HOOK, [$this, 'retryNetworkPurge'], 10);

        foreach ($this->frontendOptions() as $option) {
            remove_action('update_option_' . $option, [$this, 'onGlobalFrontendChange'], 20);
        }

        $this->registered = false;
    }

    /**
     * Captures the site + network invalidation generation used by cached HTML.
     * Missing options deliberately form a stable initial generation.
     */
    public static function generationSnapshot(?int $blogId = null): string
    {
        $blogId ??= function_exists('get_current_blog_id') ? max(1, (int) get_current_blog_id()) : 1;
        $siteValues = self::siteOptionValues($blogId, [self::SITE_GENERATION_OPTION, self::PENDING_OPTION]);
        $networkValues = self::networkOptionValues([self::NETWORK_GENERATION_OPTION, self::NETWORK_PENDING_OPTION]);

        return hash('sha256', implode("\0", [
            (string) $blogId,
            $siteValues[self::SITE_GENERATION_OPTION],
            $siteValues[self::PENDING_OPTION],
            $networkValues[self::NETWORK_GENERATION_OPTION],
            $networkValues[self::NETWORK_PENDING_OPTION],
        ]));
    }

    /** Advances the current/selected site's generation with a verified write. */
    public static function rotateSiteGeneration(?int $blogId = null): bool
    {
        $blogId ??= function_exists('get_current_blog_id') ? max(1, (int) get_current_blog_id()) : 1;
        $currentBlogId = function_exists('get_current_blog_id') ? max(1, (int) get_current_blog_id()) : 1;
        if ($blogId !== $currentBlogId) {
            if (!function_exists('switch_to_blog') || !function_exists('restore_current_blog')) {
                return false;
            }
            switch_to_blog($blogId);
            try {
                return self::rotateCurrentSiteGeneration();
            } finally {
                restore_current_blog();
            }
        }

        return self::rotateCurrentSiteGeneration();
    }

    private static function rotateCurrentSiteGeneration(): bool
    {
        if (!function_exists('update_option') || !function_exists('get_option')) {
            return false;
        }
        $token = self::generationToken();
        $updated = update_option(self::SITE_GENERATION_OPTION, $token, false);

        return $updated !== false || get_option(self::SITE_GENERATION_OPTION, '') === $token;
    }

    /** Advances the current network's generation with a verified write. */
    public static function rotateNetworkGeneration(): bool
    {
        $token = self::generationToken();
        if (self::multisiteRuntime() && function_exists('update_site_option') && function_exists('get_site_option')) {
            $updated = update_site_option(self::NETWORK_GENERATION_OPTION, $token);

            return $updated !== false || get_site_option(self::NETWORK_GENERATION_OPTION, '') === $token;
        }
        if (!function_exists('update_option') || !function_exists('get_option')) {
            return false;
        }
        $updated = update_option(self::NETWORK_GENERATION_OPTION, $token, false);

        return $updated !== false || get_option(self::NETWORK_GENERATION_OPTION, '') === $token;
    }

    public function purgeAll(?int $blogId = null): int
    {
        return $blogId === null ? $this->purgeNetworkOnce() : $this->purgeSite($blogId);
    }

    public function purgeSite(?int $blogId = null): int
    {
        $blogId = $blogId ?? $this->currentBlogId();

        return $this->purgeSiteOnce($blogId, false);
    }

    private function purgeSiteOnce(int $blogId, bool $onlyIfPending): int
    {
        $observedPending = $this->sitePendingToken($blogId);
        if ($onlyIfPending && $observedPending === null) {
            return 0;
        }
        if (!self::rotateSiteGeneration($blogId)) {
            if (!$onlyIfPending || $observedPending === null) {
                $this->markSitePending($blogId);
            }
            $this->scheduleSiteRetry($blogId);

            return 0;
        }

        $deleted = $this->store->purgeAll($blogId);
        if ($this->store->lastPurgeSucceeded()) {
            if ($observedPending !== null) {
                $this->clearSitePendingIfMatches($blogId, $observedPending);
            }
            if ($this->sitePendingToken($blogId) !== null) {
                // Another mutation arrived while this purge was running.
                $this->scheduleSiteRetry($blogId);
            }
        } else {
            if (!$onlyIfPending) {
                $this->markSitePending($blogId);
            }
            $this->scheduleSiteRetry($blogId);
        }

        return $deleted;
    }

    /** @param mixed $blogId */
    public function retrySitePurge($blogId = null): void
    {
        $blogId = filter_var($blogId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $this->purgeSiteOnce($blogId === false ? $this->currentBlogId() : (int) $blogId, true);
    }

    public function retryNetworkPurge(): void
    {
        // Cron is per site, while this marker is shared by the network. Old
        // duplicate events must become harmless after the first success.
        if (! $this->networkPurgePending()) {
            return;
        }
        if ($this->isMultisite() && ! $this->isMainSiteContext()) {
            $this->scheduleNetworkRetry();

            return;
        }

        $this->purgeNetworkOnce(true);
    }

    /**
     * Removes all logical variants for one canonical URL.
     */
    public function purgeUrl(string $url, ?int $blogId = null): int
    {
        $blogId ??= $this->currentBlogId();
        if (!$this->beginSelectiveInvalidation($blogId)) {
            return 0;
        }

        return $this->deleteUrlWithoutGeneration($url, $blogId);
    }

    private function deleteUrlWithoutGeneration(string $url, int $blogId): int
    {
        $key = CacheKey::fromUrl(
            $url,
            $blogId,
            $this->ignoredQueryParameters,
            $this->allowedQueryParameters,
        );
        if ($key === null) {
            $this->log('warning', 'cache_purge_url_ineligible');

            return 0;
        }

        return $this->store->deleteUrl($key);
    }

    /** @param iterable<string> $urls */
    public function purgeUrls(iterable $urls, ?int $blogId = null): int
    {
        $blogId ??= $this->currentBlogId();
        $unique = [];
        foreach ($urls as $url) {
            if (is_string($url) && $url !== '') {
                $unique[$url] = true;
            }
        }

        if ($unique === [] || !$this->beginSelectiveInvalidation($blogId)) {
            return 0;
        }

        $deleted = 0;
        foreach (array_keys($unique) as $url) {
            $deleted += $this->deleteUrlWithoutGeneration($url, $blogId);
        }

        return $deleted;
    }

    /**
     * Selectively purges known URLs and dependency tags for one post.
     */
    public function purgePost(int $postId): int
    {
        if ($postId < 1) {
            return 0;
        }

        $blogId = $this->currentBlogId();
        if (!$this->beginSelectiveInvalidation($blogId)) {
            return 0;
        }
        $tags = ['post:' . $postId, 'object:' . $postId];
        $urls = [];

        if (function_exists('get_permalink')) {
            $this->addUrl($urls, get_permalink($postId));
        }
        if (function_exists('home_url')) {
            $this->addUrl($urls, home_url('/'));
        } elseif (function_exists('get_home_url')) {
            $this->addUrl($urls, get_home_url($blogId, '/'));
        }

        $post = function_exists('get_post') ? get_post($postId) : null;
        if (is_object($post)) {
            $postType = isset($post->post_type) ? (string) $post->post_type : '';
            if ($postType !== '') {
                $tags[] = 'post-type:' . $postType;
                if (function_exists('get_post_type_archive_link')) {
                    $this->addUrl($urls, get_post_type_archive_link($postType));
                }
            }

            $authorId = isset($post->post_author) ? (int) $post->post_author : 0;
            if ($authorId > 0) {
                $tags[] = 'author:' . $authorId;
                if (function_exists('get_author_posts_url')) {
                    $this->addUrl($urls, get_author_posts_url($authorId));
                }
            }
        }

        if (function_exists('get_object_taxonomies') && function_exists('get_the_terms')) {
            $taxonomies = get_object_taxonomies(is_object($post) ? $post : 'post', 'names');
            if (is_array($taxonomies)) {
                foreach ($taxonomies as $taxonomy) {
                    $terms = get_the_terms($postId, (string) $taxonomy);
                    if ($terms === false || (function_exists('is_wp_error') && is_wp_error($terms)) || ! is_array($terms)) {
                        continue;
                    }
                    foreach ($terms as $term) {
                        if (! is_object($term) || ! isset($term->term_id)) {
                            continue;
                        }
                        $termId = (int) $term->term_id;
                        $tags[] = 'term:' . $termId;
                        $tags[] = 'taxonomy:' . (string) $taxonomy;
                        if (function_exists('get_term_link')) {
                            $link = get_term_link($term);
                            if (! (function_exists('is_wp_error') && is_wp_error($link))) {
                                $this->addUrl($urls, $link);
                            }
                        }
                    }
                }
            }
        }

        if (function_exists('get_option') && function_exists('get_permalink')) {
            foreach (['page_on_front', 'page_for_posts'] as $option) {
                $pageId = (int) get_option($option, 0);
                if ($pageId > 0) {
                    $this->addUrl($urls, get_permalink($pageId));
                }
            }
        }

        $deleted = $this->store->purgeByTags(array_values(array_unique($tags)), $blogId);
        foreach (array_keys($urls) as $url) {
            $deleted += $this->deleteUrlWithoutGeneration($url, $blogId);
        }

        return $deleted;
    }

    /** @param list<string> $tags */
    public function purgeTags(array $tags, ?int $blogId = null): int
    {
        $blogId ??= $this->currentBlogId();
        if (!$this->beginSelectiveInvalidation($blogId)) {
            return 0;
        }

        return $this->store->purgeByTags($tags, $blogId);
    }

    public function purgeCurrentRequest(): int
    {
        $blogId = $this->currentBlogId();
        if (!$this->beginSelectiveInvalidation($blogId)) {
            return 0;
        }
        $key = CacheKey::fromRequest(
            null,
            null,
            $blogId,
            $this->ignoredQueryParameters,
            $this->allowedQueryParameters,
        );

        return $key === null ? 0 : $this->store->deleteUrl($key);
    }

    public function onSavePost(mixed $postId, mixed $post = null, mixed $update = null): void
    {
        $postId = (int) $postId;
        if ($postId < 1 || $this->isAutosaveOrRevision($postId)) {
            return;
        }

        $status = is_object($post) && isset($post->post_status) ? (string) $post->post_status : '';
        if (in_array($status, ['auto-draft', 'inherit'], true)) {
            return;
        }

        $this->invalidatePostFromHook($postId);
    }

    public function onPostRemoved(mixed $postId, mixed $post = null): void
    {
        $postId = (int) $postId;
        if ($postId > 0 && ! $this->isAutosaveOrRevision($postId)) {
            $this->invalidatePostFromHook($postId);
        }
    }

    public function onPostMetaChanged(
        mixed $metaId,
        mixed $postId,
        mixed $metaKey = null,
        mixed $metaValue = null,
    ): void {
        $postId = (int) $postId;
        $metaKey = is_string($metaKey) ? $metaKey : '';
        if ($postId < 1 || in_array($metaKey, ['_edit_lock', '_edit_last'], true)) {
            return;
        }

        $this->invalidatePostFromHook($postId);
    }

    public function onObjectTermsChanged(
        mixed $objectId,
        mixed $terms = null,
        mixed $termTaxonomyIds = null,
        mixed $taxonomy = null,
        mixed $append = null,
        mixed $oldTermTaxonomyIds = null,
    ): void {
        $objectId = (int) $objectId;
        if ($objectId > 0) {
            $this->invalidatePostFromHook($objectId);
        }
    }

    public function onTermChanged(mixed $termId, mixed $taxonomyTermId = null, mixed $taxonomy = null): void
    {
        $this->invalidateTaxonomyFromHook((int) $termId, is_string($taxonomy) ? $taxonomy : '');
    }

    public function onTermDeleted(
        mixed $termId,
        mixed $taxonomyTermId = null,
        mixed $taxonomy = null,
        mixed $deletedTerm = null,
        mixed $objectIds = null,
    ): void {
        $this->invalidateTaxonomyFromHook((int) $termId, is_string($taxonomy) ? $taxonomy : '');
    }

    public function onCommentTransition(mixed $newStatus, mixed $oldStatus, mixed $comment): void
    {
        if ($newStatus === $oldStatus || ($newStatus !== 'approved' && $oldStatus !== 'approved')) {
            return;
        }

        $postId = is_object($comment) && isset($comment->comment_post_ID)
            ? (int) $comment->comment_post_ID
            : 0;

        if ($postId > 0) {
            $this->invalidatePostFromHook($postId);
        } else {
            $this->purgeSite();
        }
    }

    public function onCommentCreated(mixed $commentId, mixed $approved = null, mixed $commentData = null): void
    {
        if (! in_array($approved, [1, '1', 'approve', 'approved'], true)) {
            return;
        }

        $postId = is_array($commentData) && isset($commentData['comment_post_ID'])
            ? (int) $commentData['comment_post_ID']
            : $this->commentPostId((int) $commentId);
        if ($postId > 0) {
            $this->invalidatePostFromHook($postId);
        }
    }

    public function onCommentEdited(mixed $commentId, mixed $commentData = null): void
    {
        $comment = function_exists('get_comment') ? get_comment((int) $commentId) : null;
        if (! is_object($comment) || ! isset($comment->comment_approved)
            || ! in_array($comment->comment_approved, [1, '1', 'approve', 'approved'], true)) {
            return;
        }

        $postId = isset($comment->comment_post_ID) ? (int) $comment->comment_post_ID : 0;
        if ($postId > 0) {
            $this->invalidatePostFromHook($postId);
        }
    }

    public function onGlobalFrontendChange(mixed ...$unused): void
    {
        $this->purgeSite();
    }

    public function onOptionUpdated(mixed $option, mixed $oldValue = null, mixed $newValue = null): void
    {
        if (is_string($option) && str_starts_with($option, 'widget_')) {
            $this->purgeSite();
        }
    }

    public function onUpgradeComplete(mixed $upgrader = null, mixed $hookExtra = null): void
    {
        if ($this->isMultisite()) {
            $this->purgeNetworkOnce();
        } else {
            $this->purgeSite();
        }
    }

    public function onPluginStateChanged(mixed $plugin = null, mixed $networkWide = false): void
    {
        if ((bool) $networkWide) {
            $this->purgeNetworkOnce();
        } else {
            $this->purgeSite();
        }
    }

    public function onUserChanged(mixed $userId, mixed ...$unused): void
    {
        if ((int) $userId < 1) {
            return;
        }

        if ($this->isMultisite()) {
            $this->purgeNetworkOnce();
        } else {
            $this->purgeSite();
        }
    }

    private function invalidatePostFromHook(int $postId): void
    {
        try {
            if ($this->conservativeHooks) {
                $this->purgeSite();
            } else {
                $this->purgePost($postId);
            }
        } catch (Throwable $error) {
            $this->log('error', 'cache_post_invalidation_failed', [
                'post_id' => $postId,
                'error' => $error::class,
            ]);
        }
    }

    private function invalidateTaxonomyFromHook(int $termId, string $taxonomy): void
    {
        try {
            if ($this->conservativeHooks) {
                $this->purgeSite();

                return;
            }

            $tags = [];
            if ($termId > 0) {
                $tags[] = 'term:' . $termId;
                $tags[] = 'object:' . $termId;
            }
            if ($taxonomy !== '') {
                $tags[] = 'taxonomy:' . $taxonomy;
            }

            $deleted = $this->purgeTags($tags);
            if ($deleted === 0) {
                // Missing dependency metadata must not leave taxonomy archives stale.
                $this->purgeSite();
            }
        } catch (Throwable $error) {
            $this->log('error', 'cache_taxonomy_invalidation_failed', ['error' => $error::class]);
        }
    }

    private function isAutosaveOrRevision(int $postId): bool
    {
        if (defined('DOING_AUTOSAVE') && constant('DOING_AUTOSAVE')) {
            return true;
        }
        if (function_exists('wp_is_post_revision') && wp_is_post_revision($postId)) {
            return true;
        }

        return function_exists('wp_is_post_autosave') && (bool) wp_is_post_autosave($postId);
    }

    private function commentPostId(int $commentId): int
    {
        if ($commentId < 1 || ! function_exists('get_comment')) {
            return 0;
        }

        $comment = get_comment($commentId);

        return is_object($comment) && isset($comment->comment_post_ID)
            ? (int) $comment->comment_post_ID
            : 0;
    }

    /** @param array<string, true> $urls */
    private function addUrl(array &$urls, mixed $url): void
    {
        if (is_string($url) && $url !== '') {
            $urls[$url] = true;
        }
    }

    /** @return list<string> */
    private function frontendOptions(): array
    {
        return [
            'blogname',
            'blogdescription',
            'page_on_front',
            'page_for_posts',
            'permalink_structure',
            'show_on_front',
            'sidebars_widgets',
            'sticky_posts',
            'theme_mods_' . (function_exists('get_option') ? (string) get_option('stylesheet', '') : ''),
        ];
    }

    private function currentBlogId(): int
    {
        return function_exists('get_current_blog_id') ? max(1, (int) get_current_blog_id()) : 1;
    }

    private function beginSelectiveInvalidation(int $blogId): bool
    {
        if (self::rotateSiteGeneration($blogId)) {
            return true;
        }

        $this->markSitePending($blogId);
        $this->scheduleSiteRetry($blogId);

        return false;
    }

    private function purgeNetworkOnce(bool $onlyIfPending = false): int
    {
        $pendingBeforeLock = $this->networkPendingToken();
        if ($onlyIfPending && $pendingBeforeLock === null) {
            return 0;
        }

        if (!self::rotateNetworkGeneration()) {
            if (!$onlyIfPending || $pendingBeforeLock === null) {
                $this->markNetworkPending();
            }
            $this->scheduleNetworkRetry();

            return 0;
        }

        if (! $this->acquireNetworkRetryLock()) {
            if (!$onlyIfPending) {
                $this->markNetworkPending();
            }
            $this->scheduleNetworkRetry();

            return 0;
        }

        try {
            // Observe the exact invalidation generation covered by this purge.
            // A newer token created during I/O must survive this worker.
            $observedPending = $this->networkPendingToken();
            if ($onlyIfPending && $observedPending === null) {
                return 0;
            }

            $purge = $this->purgeCurrentNetworkPages();
            $deleted = $purge['deleted'];
            if ($purge['success']) {
                if ($observedPending !== null) {
                    $this->clearNetworkPendingIfMatches($observedPending);
                }
                if ($this->networkPendingToken() !== null) {
                    $this->scheduleNetworkRetry();
                }
            } else {
                if (!$onlyIfPending) {
                    $this->markNetworkPending();
                }
                $this->scheduleNetworkRetry();
            }

            return $deleted;
        } finally {
            $this->releaseNetworkRetryLock();
        }
    }

    /**
     * Physically purges only sites belonging to the current network. The
     * network generation is rotated before this method is called, so a late
     * response from any of these sites fails its write guard. Caches from
     * other networks are neither deleted nor logically invalidated.
     *
     * @return array{deleted:int,success:bool}
     */
    private function purgeCurrentNetworkPages(): array
    {
        if (!$this->isMultisite()) {
            $deleted = $this->store->purgeAll($this->currentBlogId());

            return ['deleted' => $deleted, 'success' => $this->store->lastPurgeSucceeded()];
        }

        if (!function_exists('get_sites') || !function_exists('get_current_network_id')) {
            return ['deleted' => 0, 'success' => false];
        }

        $networkId = max(1, (int) get_current_network_id());
        $offset = 0;
        $deleted = 0;
        $success = true;
        $seen = [];

        do {
            try {
                $page = get_sites([
                    'fields' => 'ids',
                    'number' => 100,
                    'offset' => $offset,
                    'network_id' => $networkId,
                    'orderby' => 'id',
                    'order' => 'ASC',
                ]);
            } catch (Throwable $error) {
                $this->log('error', 'cache_network_sites_unavailable', ['error' => $error::class]);

                return ['deleted' => $deleted, 'success' => false];
            }

            if (!is_array($page)) {
                return ['deleted' => $deleted, 'success' => false];
            }

            $pageCount = count($page);
            $newSites = 0;
            foreach ($page as $siteId) {
                $siteId = filter_var($siteId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
                if ($siteId === false) {
                    $success = false;
                    continue;
                }

                $siteId = (int) $siteId;
                if (isset($seen[$siteId])) {
                    continue;
                }
                $seen[$siteId] = true;
                $newSites++;

                $deleted += $this->store->purgeAll($siteId);
                if (!$this->store->lastPurgeSucceeded()) {
                    $success = false;
                }
            }

            // A filter that ignores offset could otherwise hold the request in
            // an infinite loop. Keep the network pending and retry instead.
            if ($pageCount === 100 && $newSites === 0) {
                return ['deleted' => $deleted, 'success' => false];
            }
            $offset += $pageCount;
        } while ($pageCount === 100);

        // A running plugin always belongs to at least one site. Treat an empty
        // or malformed network query as an incomplete purge, never as success.
        return ['deleted' => $deleted, 'success' => $success && $seen !== []];
    }

    private function schedulePendingRetries(): void
    {
        if (function_exists('get_option') && get_option(self::PENDING_OPTION, false)) {
            $this->scheduleSiteRetry($this->currentBlogId());
        }
        if ($this->networkPurgePending()) {
            $this->scheduleNetworkRetry();
        }
    }

    private function scheduleSiteRetry(int $blogId): void
    {
        if (! function_exists('wp_schedule_single_event')) {
            return;
        }

        $args = [$blogId];
        if (function_exists('wp_next_scheduled') && wp_next_scheduled(self::RETRY_SITE_HOOK, $args)) {
            return;
        }

        wp_schedule_single_event(time() + 30, self::RETRY_SITE_HOOK, $args, true);
    }

    private function scheduleNetworkRetry(): void
    {
        if (! function_exists('wp_schedule_single_event')) {
            return;
        }

        $schedule = static function (): void {
            if (function_exists('wp_next_scheduled') && wp_next_scheduled(self::RETRY_NETWORK_HOOK)) {
                return;
            }
            wp_schedule_single_event(time() + 30, self::RETRY_NETWORK_HOOK, [], true);
        };

        if (! $this->isMultisite() || $this->isMainSiteContext()) {
            $schedule();

            return;
        }

        $mainSiteId = function_exists('get_main_site_id') ? max(1, (int) get_main_site_id()) : 1;
        if (function_exists('switch_to_blog') && function_exists('restore_current_blog')) {
            switch_to_blog($mainSiteId);
            try {
                $schedule();
            } finally {
                restore_current_blog();
            }

            return;
        }

        // Core multisite always provides blog switching. This conservative
        // fallback still guarantees a retry in unusual test/bootstrap states.
        $schedule();
    }

    private function markSitePending(int $blogId): void
    {
        $token = $this->pendingToken();
        if ($blogId === $this->currentBlogId() && function_exists('update_option')) {
            update_option(self::PENDING_OPTION, $token, false);

            return;
        }

        if (function_exists('switch_to_blog') && function_exists('restore_current_blog') && function_exists('update_option')) {
            switch_to_blog($blogId);
            try {
                update_option(self::PENDING_OPTION, $token, false);
            } finally {
                restore_current_blog();
            }

            return;
        }

        // If a foreign site's option cannot be reached, bypass every site in
        // the network rather than risk serving stale content there.
        $this->markNetworkPending();
    }

    private function sitePendingToken(int $blogId): ?string
    {
        if ($blogId === $this->currentBlogId() && function_exists('get_option')) {
            $value = get_option(self::PENDING_OPTION, false);

            return is_scalar($value) && (string) $value !== '' ? (string) $value : null;
        }

        if (function_exists('switch_to_blog') && function_exists('restore_current_blog') && function_exists('get_option')) {
            switch_to_blog($blogId);
            try {
                $value = get_option(self::PENDING_OPTION, false);

                return is_scalar($value) && (string) $value !== '' ? (string) $value : null;
            } finally {
                restore_current_blog();
            }
        }

        return $this->networkPurgePending() ? 'network-pending' : null;
    }

    private function clearSitePendingIfMatches(int $blogId, string $expected): bool
    {
        if ($blogId === $this->currentBlogId()) {
            return $this->deleteCurrentOptionIfMatches(self::PENDING_OPTION, $expected);
        }

        if (function_exists('switch_to_blog') && function_exists('restore_current_blog')) {
            switch_to_blog($blogId);
            try {
                return $this->deleteCurrentOptionIfMatches(self::PENDING_OPTION, $expected);
            } finally {
                restore_current_blog();
            }
        }

        return false;
    }

    private function markNetworkPending(): void
    {
        $token = $this->pendingToken();
        if (function_exists('update_site_option')) {
            update_site_option(self::NETWORK_PENDING_OPTION, $token);
        } elseif (function_exists('update_option')) {
            update_option(self::NETWORK_PENDING_OPTION, $token, false);
        }
    }

    private function networkPendingToken(): ?string
    {
        if (function_exists('get_site_option')) {
            $value = get_site_option(self::NETWORK_PENDING_OPTION, false);

            return is_scalar($value) && (string) $value !== '' ? (string) $value : null;
        }

        $value = function_exists('get_option') ? get_option(self::NETWORK_PENDING_OPTION, false) : false;

        return is_scalar($value) && (string) $value !== '' ? (string) $value : null;
    }

    private function networkPurgePending(): bool
    {
        return $this->networkPendingToken() !== null;
    }

    private function clearNetworkPendingIfMatches(string $expected): bool
    {
        return $this->deleteNetworkOptionValue(self::NETWORK_PENDING_OPTION, $expected, true);
    }

    private function pendingToken(): string
    {
        return time() . ':' . $this->lockToken();
    }

    private static function generationToken(): string
    {
        try {
            return bin2hex(random_bytes(16));
        } catch (Throwable) {
            return hash('sha256', uniqid('kodety-rocket-generation-', true) . '|' . microtime(true));
        }
    }

    private static function multisiteRuntime(): bool
    {
        return function_exists('is_multisite') && (bool) is_multisite();
    }

    /** @param list<string> $optionNames @return array<string, string> */
    private static function networkOptionValues(array $optionNames): array
    {
        if (!self::multisiteRuntime()) {
            return self::currentOptionValues($optionNames);
        }

        global $wpdb;
        $networkId = isset($wpdb) && is_object($wpdb) && isset($wpdb->siteid)
            ? max(1, (int) $wpdb->siteid)
            : 1;
        if (function_exists('get_current_network_id')) {
            $networkId = max(1, (int) get_current_network_id());
        }
        $databaseValues = self::databaseOptionValues(
            isset($wpdb) && is_object($wpdb) && isset($wpdb->sitemeta) && is_string($wpdb->sitemeta)
                ? $wpdb->sitemeta
                : '',
            'meta_key',
            'meta_value',
            $optionNames,
            $networkId
        );
        if ($databaseValues['supported']) {
            return $databaseValues['ok']
                ? $databaseValues['values']
                : self::unavailableOptionValues($optionNames);
        }

        $values = [];
        foreach ($optionNames as $optionName) {
            $value = function_exists('get_site_option') ? get_site_option($optionName, '') : '';
            $values[$optionName] = is_scalar($value) ? (string) $value : '';
        }

        return $values;
    }

    /** @param list<string> $optionNames @return array<string, string> */
    private static function siteOptionValues(int $blogId, array $optionNames): array
    {
        $currentBlogId = function_exists('get_current_blog_id') ? max(1, (int) get_current_blog_id()) : 1;
        if ($blogId === $currentBlogId) {
            return self::currentOptionValues($optionNames);
        }
        if (!function_exists('switch_to_blog') || !function_exists('restore_current_blog')) {
            return self::unavailableOptionValues($optionNames);
        }

        switch_to_blog($blogId);
        try {
            return self::currentOptionValues($optionNames);
        } finally {
            restore_current_blog();
        }
    }

    /** @param list<string> $optionNames @return array<string, string> */
    private static function currentOptionValues(array $optionNames): array
    {
        global $wpdb;
        $databaseValues = self::databaseOptionValues(
            isset($wpdb) && is_object($wpdb) && isset($wpdb->options) && is_string($wpdb->options)
                ? $wpdb->options
                : '',
            'option_name',
            'option_value',
            $optionNames,
            null
        );
        if ($databaseValues['supported']) {
            return $databaseValues['ok']
                ? $databaseValues['values']
                : self::unavailableOptionValues($optionNames);
        }

        $values = [];
        foreach ($optionNames as $optionName) {
            $value = function_exists('get_option') ? get_option($optionName, '') : '';
            $values[$optionName] = is_scalar($value) ? (string) $value : '';
        }

        return $values;
    }

    /**
     * @param list<string> $optionNames
     * @return array{supported: bool, ok: bool, values: array<string, string>}
     */
    private static function databaseOptionValues(
        string $tableName,
        string $keyColumn,
        string $valueColumn,
        array $optionNames,
        ?int $networkId
    ): array {
        global $wpdb;

        $defaults = array_fill_keys($optionNames, '');
        if (!isset($wpdb) || !is_object($wpdb)
            || !method_exists($wpdb, 'prepare')
            || !method_exists($wpdb, 'get_results')) {
            return ['supported' => false, 'ok' => false, 'values' => $defaults];
        }
        $table = preg_replace('/[^A-Za-z0-9_$]/', '', $tableName);
        if (!is_string($table) || $table === '' || $optionNames === []) {
            return ['supported' => true, 'ok' => false, 'values' => $defaults];
        }
        $placeholders = implode(', ', array_fill(0, count($optionNames), '%s'));
        $where = "{$keyColumn} IN ({$placeholders})";
        $arguments = $optionNames;
        if ($networkId !== null) {
            $where = 'site_id = %d AND ' . $where;
            array_unshift($arguments, $networkId);
        }
        $sql = $wpdb->prepare(
            "SELECT {$keyColumn} AS option_key, {$valueColumn} AS option_value FROM {$table} WHERE {$where}",
            ...$arguments
        );
        if (!is_string($sql)) {
            return ['supported' => true, 'ok' => false, 'values' => $defaults];
        }
        $rows = $wpdb->get_results($sql, 'ARRAY_A');
        $lastError = isset($wpdb->last_error) && is_string($wpdb->last_error)
            ? $wpdb->last_error
            : '';
        if ($lastError !== '' || !is_array($rows)) {
            return ['supported' => true, 'ok' => false, 'values' => $defaults];
        }

        foreach ($rows as $row) {
            if (!is_array($row) || !isset($row['option_key']) || !is_scalar($row['option_key'])) {
                continue;
            }
            $key = (string) $row['option_key'];
            if (!array_key_exists($key, $defaults)) {
                continue;
            }
            $value = $row['option_value'] ?? '';
            $defaults[$key] = is_scalar($value) ? (string) $value : '';
        }

        return ['supported' => true, 'ok' => true, 'values' => $defaults];
    }

    /** @param list<string> $optionNames @return array<string, string> */
    private static function unavailableOptionValues(array $optionNames): array
    {
        $token = 'unavailable:' . self::generationToken();

        return array_fill_keys($optionNames, $token);
    }

    private function isMainSiteContext(): bool
    {
        if (! $this->isMultisite()) {
            return true;
        }
        if (function_exists('is_main_site')) {
            return (bool) is_main_site();
        }

        $mainSiteId = function_exists('get_main_site_id') ? max(1, (int) get_main_site_id()) : 1;

        return $this->currentBlogId() === $mainSiteId;
    }

    private function acquireNetworkRetryLock(): bool
    {
        if ($this->networkRetryLockValue !== null) {
            return true;
        }

        $value = $this->lockToken() . '|' . (time() + 5 * 60);
        if (function_exists('add_site_option') && function_exists('get_site_option')) {
            if (add_site_option(self::NETWORK_RETRY_LOCK_OPTION, $value)) {
                $this->networkRetryLockValue = $value;
                $this->networkRetryLockUsesSiteOption = true;

                return true;
            }
            $existing = get_site_option(self::NETWORK_RETRY_LOCK_OPTION, '');
            if (is_string($existing) && $this->optionLockExpired($existing)
                && $this->deleteNetworkOptionValue(self::NETWORK_RETRY_LOCK_OPTION, $existing, true)
                && add_site_option(self::NETWORK_RETRY_LOCK_OPTION, $value)) {
                $this->networkRetryLockValue = $value;
                $this->networkRetryLockUsesSiteOption = true;

                return true;
            }

            return false;
        }

        if (! function_exists('add_option') || ! function_exists('get_option')) {
            return false;
        }
        if (add_option(self::NETWORK_RETRY_LOCK_OPTION, $value, '', false)) {
            $this->networkRetryLockValue = $value;
            $this->networkRetryLockUsesSiteOption = false;

            return true;
        }
        $existing = get_option(self::NETWORK_RETRY_LOCK_OPTION, '');
        if (is_string($existing) && $this->optionLockExpired($existing)
            && $this->deleteNetworkOptionValue(self::NETWORK_RETRY_LOCK_OPTION, $existing, false)
            && add_option(self::NETWORK_RETRY_LOCK_OPTION, $value, '', false)) {
            $this->networkRetryLockValue = $value;
            $this->networkRetryLockUsesSiteOption = false;

            return true;
        }

        return false;
    }

    private function releaseNetworkRetryLock(): void
    {
        $owned = $this->networkRetryLockValue;
        if ($owned === null) {
            return;
        }

        $this->deleteNetworkOptionValue(
            self::NETWORK_RETRY_LOCK_OPTION,
            $owned,
            $this->networkRetryLockUsesSiteOption
        );
        $this->networkRetryLockValue = null;
    }

    private function lockToken(): string
    {
        try {
            return bin2hex(random_bytes(16));
        } catch (Throwable) {
            return hash('sha256', uniqid('kodety-rocket-network-', true) . '|' . microtime(true));
        }
    }

    private function optionLockExpired(string $value): bool
    {
        $separator = strrpos($value, '|');
        if ($separator === false) {
            return false;
        }
        $expires = filter_var(substr($value, $separator + 1), FILTER_VALIDATE_INT);

        return $expires !== false && $expires <= time();
    }

    private function deleteCurrentOptionIfMatches(string $optionName, string $expected): bool
    {
        global $wpdb;

        if (isset($wpdb) && is_object($wpdb)
            && isset($wpdb->options)
            && is_string($wpdb->options)
            && method_exists($wpdb, 'prepare')
            && method_exists($wpdb, 'query')) {
            $table = preg_replace('/[^A-Za-z0-9_$]/', '', $wpdb->options);
            if (is_string($table) && $table !== '') {
                $sql = $wpdb->prepare(
                    "DELETE FROM {$table} WHERE option_name = %s AND option_value = %s",
                    $optionName,
                    $expected
                );
                $deleted = is_string($sql) ? $wpdb->query($sql) : false;
                if ($deleted === 1) {
                    if (function_exists('wp_cache_delete')) {
                        wp_cache_delete($optionName, 'options');
                    }

                    return true;
                }

                return false;
            }
        }

        if (! function_exists('get_option') || ! function_exists('delete_option')) {
            return false;
        }
        $current = get_option($optionName, '');

        return is_scalar($current)
            && hash_equals($expected, (string) $current)
            && delete_option($optionName);
    }

    /** Deletes only the exact network option value observed by this worker. */
    private function deleteNetworkOptionValue(string $optionName, string $expected, bool $siteOption): bool
    {
        global $wpdb;

        if (!$siteOption) {
            return $this->deleteCurrentOptionIfMatches($optionName, $expected);
        }
        // Core's site-option API delegates to wp_options on single-site. Using
        // sitemeta (or a get/delete fallback) there would lose atomicity.
        if (function_exists('is_multisite') && !is_multisite()) {
            return $this->deleteCurrentOptionIfMatches($optionName, $expected);
        }

        if (isset($wpdb) && is_object($wpdb)
            && isset($wpdb->sitemeta)
            && is_string($wpdb->sitemeta)
            && method_exists($wpdb, 'prepare')
            && method_exists($wpdb, 'query')) {
            $table = preg_replace('/[^A-Za-z0-9_$]/', '', $wpdb->sitemeta);
            $networkId = function_exists('get_current_network_id')
                ? max(1, (int) get_current_network_id())
                : (isset($wpdb->siteid) ? max(1, (int) $wpdb->siteid) : 1);
            if (is_string($table) && $table !== '') {
                $sql = $wpdb->prepare(
                    "DELETE FROM {$table} WHERE site_id = %d AND meta_key = %s AND meta_value = %s",
                    $networkId,
                    $optionName,
                    $expected
                );
                $deleted = is_string($sql) ? $wpdb->query($sql) : false;
                if ($deleted === 1) {
                    if (function_exists('wp_cache_delete')) {
                        wp_cache_delete($networkId . ':' . $optionName, 'site-options');
                    }

                    return true;
                }

                return false;
            }
        }

        if (!function_exists('get_site_option') || !function_exists('delete_site_option')) {
            return false;
        }
        $current = get_site_option($optionName, '');

        return is_scalar($current)
            && hash_equals($expected, (string) $current)
            && delete_site_option($optionName);
    }

    private function isMultisite(): bool
    {
        return self::multisiteRuntime();
    }

    /** @param array<string, mixed> $context */
    private function log(string $level, string $message, array $context = []): void
    {
        try {
            if (is_callable($this->logger)) {
                ($this->logger)($level, $message, $context);

                return;
            }
            if (is_object($this->logger) && method_exists($this->logger, $level)) {
                $this->logger->{$level}($message, $context);

                return;
            }
            if (is_object($this->logger) && method_exists($this->logger, 'log')) {
                $this->logger->log($level, $message, $context);
            }
        } catch (Throwable) {
            // Invalidation remains fail-open even if diagnostics fail.
        }
    }
}
