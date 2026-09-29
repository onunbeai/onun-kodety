<?php

declare(strict_types=1);

namespace KodetyRocket\Support;

/**
 * Inline icon sprite for the isolated admin application.
 *
 * Navigation symbols use Solar Bold Duotone geometry. Action and control
 * symbols use the official Keyline Icons 2px stroke geometry.
 */
final class Icons
{
    /** @var string[] */
    private const NAMES = [
        'solar-widget',
        'solar-server',
        'solar-code',
        'solar-speedometer',
        'solar-graph',
        'solar-settings',
        'keyline-activity',
        'keyline-arrow-up-right',
        'keyline-check',
        'keyline-chevron-right',
        'keyline-clock',
        'keyline-code',
        'keyline-database',
        'keyline-globe',
        'keyline-hard-drive',
        'keyline-history',
        'keyline-image',
        'keyline-info',
        'keyline-moon',
        'keyline-play',
        'keyline-refresh',
        'keyline-save',
        'keyline-shield',
        'keyline-sun',
        'keyline-trash',
        'keyline-zap',
    ];

    public static function icon(string $name, string $class = ''): string
    {
        if (!in_array($name, self::NAMES, true)) {
            $name = 'keyline-info';
        }

        $class = trim('kr-icon ' . $class);
        $escape = static function (string $value): string {
            if (function_exists('esc_attr')) {
                return esc_attr($value);
            }

            return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
        };

        return sprintf(
            '<svg class="%s" aria-hidden="true" focusable="false"><use href="#kr-%s"></use></svg>',
            $escape($class),
            $escape($name)
        );
    }

    public static function sprite(): string
    {
        return <<<'SVG'
<svg class="kr-icon-sprite" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <symbol id="kr-solar-widget" viewBox="0 0 24 24">
      <path d="M2 6.5C2 4.379 2 3.318 2.659 2.659S4.379 2 6.5 2s3.182 0 3.841.659S11 4.379 11 6.5s0 3.182-.659 3.841S8.621 11 6.5 11s-3.182 0-3.841-.659S2 8.621 2 6.5Z" fill="currentColor" opacity=".42"/>
      <path d="M13 17.5c0-2.121 0-3.182.659-3.841S15.379 13 17.5 13s3.182 0 3.841.659S22 15.379 22 17.5s0 3.182-.659 3.841S19.621 22 17.5 22s-3.182 0-3.841-.659S13 19.621 13 17.5Z" fill="currentColor" opacity=".42"/>
      <path d="M2 17.5c0-2.121 0-3.182.659-3.841S4.379 13 6.5 13s3.182 0 3.841.659S11 15.379 11 17.5s0 3.182-.659 3.841S8.621 22 6.5 22s-3.182 0-3.841-.659S2 19.621 2 17.5ZM13 6.5c0-2.121 0-3.182.659-3.841S15.379 2 17.5 2s3.182 0 3.841.659S22 4.379 22 6.5s0 3.182-.659 3.841S19.621 11 17.5 11s-3.182 0-3.841-.659S13 8.621 13 6.5Z" fill="currentColor"/>
    </symbol>
    <symbol id="kr-solar-server" viewBox="0 0 24 24">
      <path d="M14 21h-4c-3.771 0-5.657 0-6.828-1.172C2 18.657 2 16.771 2 13v-.25h20V13c0 3.771 0 5.657-1.172 6.828C19.657 21 17.771 21 14 21ZM10 3h4c3.771 0 5.657 0 6.828 1.172C22 5.343 22 7.229 22 11v.25H2V11c0-3.771 0-5.657 1.172-6.828C4.343 3 6.229 3 10 3Z" fill="currentColor" opacity=".42"/>
      <path fill-rule="evenodd" d="M22 12.75H2v-1.5h20v1.5ZM12.75 16.5a.75.75 0 0 1 .75-.75H18a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75ZM12.75 7.5a.75.75 0 0 1 .75-.75H18a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75ZM6 18.25a.75.75 0 0 1-.75-.75v-2a.75.75 0 0 1 1.5 0v2a.75.75 0 0 1-.75.75ZM6 9.25a.75.75 0 0 1-.75-.75v-2a.75.75 0 0 1 1.5 0v2a.75.75 0 0 1-.75.75ZM9 18.25a.75.75 0 0 1-.75-.75v-2a.75.75 0 0 1 1.5 0v2a.75.75 0 0 1-.75.75ZM9 9.25a.75.75 0 0 1-.75-.75v-2a.75.75 0 0 1 1.5 0v2a.75.75 0 0 1-.75.75Z" fill="currentColor"/>
    </symbol>
    <symbol id="kr-solar-code" viewBox="0 0 24 24">
      <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10Z" fill="currentColor" opacity=".42"/>
      <path d="M13.488 6.446a.75.75 0 0 1 .53.919l-2.588 9.659a.75.75 0 1 1-1.449-.389l2.589-9.659a.75.75 0 0 1 .918-.53ZM14.97 8.47a.75.75 0 0 1 1.06 0l.209.208c.635.635 1.165 1.165 1.529 1.642.384.504.654 1.036.654 1.68s-.27 1.176-.654 1.68c-.364.477-.894 1.007-1.529 1.642l-.209.208a.75.75 0 0 1-1.06-1.06l.171-.172c.682-.682 1.139-1.141 1.434-1.528.283-.37.347-.586.347-.77 0-.184-.064-.4-.347-.77-.295-.387-.752-.846-1.434-1.528l-.171-.172a.75.75 0 0 1 0-1.06ZM7.97 8.47a.75.75 0 0 1 1.061 1.06l-.172.172c-.682.682-1.138 1.141-1.434 1.528-.282.37-.346.586-.346.77 0 .184.064.4.346.77.296.387.752.846 1.434 1.528l.172.172a.75.75 0 0 1-1.061 1.06l-.208-.208c-.636-.635-1.165-1.165-1.529-1.642-.384-.504-.654-1.036-.654-1.68s.27-1.176.654-1.68c.364-.477.893-1.007 1.529-1.642l.208-.208Z" fill="currentColor"/>
    </symbol>
    <symbol id="kr-solar-speedometer" viewBox="0 0 24 24">
      <path d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12Z" fill="currentColor" opacity=".42"/>
      <path d="M10.115 14.353C8.94018 13.1798 8.94018 11.2777 10.115 10.1045C11.2898 8.93131 13.1946 8.93131 14.3694 10.1045C14.8163 10.5508 15.1284 11.4772 15.3436 12.4539C15.6654 13.9144 15.8263 14.6447 15.2439 15.2263C14.6615 15.8079 13.9302 15.6472 12.4676 15.3259C11.4896 15.111 10.5619 14.7993 10.115 14.353Z" fill="currentColor"/>
      <path d="M4.42077 5.4763C4.74602 5.09877 5.09899 4.7458 5.47653 4.42057C5.49505 4.43584 5.51301 4.45214 5.53033 4.46946L7.03033 5.96946C7.32322 6.26235 7.32322 6.73722 7.03033 7.03012C6.73744 7.32301 6.26256 7.32301 5.96967 7.03012L4.46967 5.53012C4.45234 5.51279 4.43604 5.49483 4.42077 5.4763Z" fill="currentColor"/>
      <path d="M2.02769 12.7498C2.00934 12.5023 2 12.2522 2 12C2 11.7476 2.00935 11.4975 2.02772 11.2498H4C4.41421 11.2498 4.75 11.5856 4.75 11.9998C4.75 12.414 4.41421 12.7498 4 12.7498H2.02769Z" fill="currentColor"/>
      <path d="M5.47628 19.5792C5.09877 19.254 4.74581 18.901 4.42059 18.5235C4.43591 18.5049 4.45228 18.4869 4.46967 18.4695L5.96967 16.9695C6.26256 16.6766 6.73744 16.6766 7.03033 16.9695C7.32322 17.2623 7.32322 17.7372 7.03033 18.0301L5.53033 19.5301C5.51293 19.5475 5.49489 19.5639 5.47628 19.5792Z" fill="currentColor"/>
      <path d="M19.5794 18.5235C19.2542 18.901 18.9012 19.254 18.5237 19.5792C18.5051 19.5639 18.4871 19.5475 18.4697 19.5301L16.9697 18.0301C16.6768 17.7372 16.6768 17.2623 16.9697 16.9695C17.2626 16.6766 17.7374 16.6766 18.0303 16.9695L19.5303 18.4695C19.5477 18.4869 19.5641 18.5049 19.5794 18.5235Z" fill="currentColor"/>
      <path d="M21.9723 11.2498C21.9907 11.4975 22 11.7476 22 12C22 12.2522 21.9907 12.5023 21.9723 12.7498H19.9998C19.5856 12.7498 19.2498 12.414 19.2498 11.9998C19.2498 11.5856 19.5856 11.2498 19.9998 11.2498H21.9723Z" fill="currentColor"/>
      <path d="M18.5235 4.42057C18.901 4.7458 19.254 5.09877 19.5792 5.4763C19.564 5.49483 19.5477 5.51279 19.5303 5.53012L18.0303 7.03012C17.7374 7.32301 17.2626 7.32301 16.9697 7.03012C16.6768 6.73722 16.6768 6.26235 16.9697 5.96946L18.4697 4.46946C18.487 4.45214 18.5049 4.43584 18.5235 4.42057Z" fill="currentColor"/>
      <path d="M12.75 2.0277V4C12.75 4.41421 12.4142 4.75 12 4.75C11.5858 4.75 11.25 4.41421 11.25 4V2.0277C11.4976 2.00934 11.7477 2 12 2C12.2523 2 12.5024 2.00934 12.75 2.0277Z" fill="currentColor"/>
    </symbol>
    <symbol id="kr-solar-graph" viewBox="0 0 24 24">
      <path d="M2 12c0-4.714 0-7.071 1.464-8.536C4.929 2 7.286 2 12 2s7.071 0 8.536 1.464C22 4.929 22 7.286 22 12s0 7.071-1.464 8.536C19.071 22 16.714 22 12 22s-7.071 0-8.536-1.464C2 19.071 2 16.714 2 12Z" fill="currentColor" opacity=".42"/>
      <path d="M14.5 10.75a.75.75 0 0 1 0-1.5H17c.414 0 .75.336.75.75v2.5a.75.75 0 0 1-1.5 0v-.689l-2.013 2.012a1.75 1.75 0 0 1-2.474 0l-1.586-1.586a.25.25 0 0 0-.354 0L7.53 14.53a.75.75 0 0 1-1.06-1.06l2.292-2.293a1.75 1.75 0 0 1 2.475 0l1.586 1.586a.25.25 0 0 0 .354 0l2.012-2.013H14.5Z" fill="currentColor"/>
    </symbol>
    <symbol id="kr-solar-settings" viewBox="0 0 24 24">
      <path fill-rule="evenodd" d="M14.279 2.152C13.908 2 13.439 2 12.5 2s-1.408 0-1.779.152a2.006 2.006 0 0 0-1.09 1.083c-.094.223-.13.483-.145.863a1.604 1.604 0 0 1-.796 1.353 1.61 1.61 0 0 1-1.579.008c-.338-.178-.583-.276-.825-.308a2.017 2.017 0 0 0-1.49.396c-.318.242-.553.646-1.022 1.453-.47.807-.704 1.21-.757 1.605-.069.526.074 1.058.4 1.479.148.192.357.353.681.555.476.297.782.803.782 1.361 0 .558-.306 1.064-.782 1.361-.324.202-.533.363-.682.555a2.006 2.006 0 0 0-.399 1.479c.053.394.287.798.757 1.605.469.807.704 1.211 1.022 1.453.424.323.96.465 1.49.396.242-.032.487-.131.825-.308a1.61 1.61 0 0 1 1.579.008c.487.279.775.795.796 1.353.015.38.051.64.145.863.204.49.597.88 1.09 1.083.371.152.84.152 1.779.152s1.408 0 1.779-.152a2.006 2.006 0 0 0 1.09-1.083c.094-.223.13-.483.145-.863.021-.558.309-1.074.796-1.353a1.61 1.61 0 0 1 1.579-.008c.338.177.583.276.825.308.53.069 1.066-.073 1.49-.396.318-.242.553-.646 1.022-1.453.47-.807.704-1.211.757-1.605a2.006 2.006 0 0 0-.4-1.479c-.148-.192-.357-.353-.681-.555a1.604 1.604 0 0 1-.782-1.361c0-.558.306-1.064.782-1.361.324-.202.533-.363.682-.555.325-.421.468-.953.399-1.479-.053-.395-.287-.798-.757-1.605-.469-.807-.704-1.211-1.022-1.453a2.017 2.017 0 0 0-1.49-.396c-.242.032-.487.13-.825.308a1.61 1.61 0 0 1-1.579-.008 1.604 1.604 0 0 1-.796-1.353c-.015-.38-.051-.64-.145-.863a2.006 2.006 0 0 0-1.09-1.083Z" fill="currentColor" opacity=".42"/>
      <path d="M15.523 12c0 1.657-1.354 3-3.023 3-1.67 0-3.023-1.343-3.023-3s1.354-3 3.023-3c1.67 0 3.023 1.343 3.023 3Z" fill="currentColor"/>
    </symbol>

    <!-- Keyline Icons 0.3.0, official stroke geometry (MIT). -->
    <symbol id="kr-keyline-activity" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12H5L8 4L16 20L19 12H22" fill="none"/></symbol>
    <symbol id="kr-keyline-arrow-up-right" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6H17.5C17.77614 6 18 6.22386 18 6.5V18M7.2 16.8L17.4 6.6"/></symbol>
    <symbol id="kr-keyline-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12L9.66667 17L19 7"/></symbol>
    <symbol id="kr-keyline-chevron-right" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6L15 12L9 18"/></symbol>
    <symbol id="kr-keyline-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.1962 9L12 12L7.6699 9.5M12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2Z"/></symbol>
    <symbol id="kr-keyline-code" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7L2 12L6 17M18 7L22 12L18 17M10 19L14 5"/></symbol>
    <symbol id="kr-keyline-database" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 4C20 5.1046 16.4184 6 12 6C7.5816 6 4 5.1046 4 4C4 2.8954 7.5816 2 12 2C16.4184 2 20 2.8954 20 4ZM4 4L4 20C4 21.1046 7.5816 22 12 22C16.4184 22 20 21.1046 20 20L20 4M4 12C4 13.1046 7.5816 14 12 14C16.4184 14 20 13.1046 20 12"/></symbol>
    <symbol id="kr-keyline-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12ZM2 12H22M12 2C14.6667 5 16 8.5 16 12C16 15.5 14.6667 19 12 22C9.33333 19 8 15.5 8 12C8 8.5 9.33333 5 12 2Z"/></symbol>
    <symbol id="kr-keyline-hard-drive" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L18 2C19.1046 2 20 2.8954 20 4L20 8C20 9.1046 19.1046 10 18 10L6 10C4.8954 10 4 9.1046 4 8L4 4C4 2.8954 4.8954 2 6 2ZM6 14L18 14C19.1046 14 20 14.8954 20 16L20 20C20 21.1046 19.1046 22 18 22L6 22C4.8954 22 4 21.1046 4 20L4 16C4 14.8954 4.8954 14 6 14Z" fill="none"/><path d="M9 6C9 6.5523 8.5523 7 8 7C7.4477 7 7 6.5523 7 6C7 5.4477 7.4477 5 8 5C8.5523 5 9 5.4477 9 6ZM13 6C13 6.5523 12.5523 7 12 7C11.4477 7 11 6.5523 11 6C11 5.4477 11.4477 5 12 5C12.5523 5 13 5.4477 13 6ZM9 18C9 18.5523 8.5523 19 8 19C7.4477 19 7 18.5523 7 18C7 17.4477 7.4477 17 8 17C8.5523 17 9 17.4477 9 18ZM13 18C13 18.5523 12.5523 19 12 19C11.4477 19 11 18.5523 11 18C11 17.4477 11.4477 17 12 17C12.5523 17 13 17.4477 13 18Z" fill="currentColor" stroke="none"/></symbol>
    <symbol id="kr-keyline-history" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.7883 13.9407C20.929 13.3034 21 12.6527 21 12C21 7.0294 16.9706 3 12 3C9.5169 3 7.1441 4.0259 5.4432 5.8349M4.2857 3L4.7293 6.105C4.7683 6.3784 5.0216 6.5683 5.295 6.5293L8.4 6.0857M3.2117 10.0593C3.071 10.6966 3 11.3473 3 12C3 16.9706 7.0294 21 12 21C14.4831 21 16.8559 19.9741 18.5568 18.1651M19.7143 21L19.2707 17.895C19.2317 17.6216 18.9784 17.4317 18.705 17.4707L15.6 17.9143"/></symbol>
    <symbol id="kr-keyline-image" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3L18 3C19.6569 3 21 4.3431 21 6L21 18C21 19.6569 19.6569 21 18 21L6 21C4.3431 21 3 19.6569 3 18L3 6C3 4.3431 4.3431 3 6 3ZM3 18L7.9393 13.0607C8.5251 12.4749 9.4749 12.4749 10.0607 13.0607L12.0801 15.0801C12.6079 15.6079 13.4436 15.6673 14.0408 15.2194L15.9592 13.7806C16.5564 13.3327 17.3921 13.3921 17.9199 13.9199L21 17"/><path d="M9.5 7.5C9.5 8.3284 8.8284 9 8 9C7.1716 9 6.5 8.3284 6.5 7.5C6.5 6.6716 7.1716 6 8 6C8.8284 6 9.5 6.6716 9.5 7.5Z" fill="currentColor" stroke="none"/></symbol>
    <symbol id="kr-keyline-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2Z"/><path d="M12 12V16"/><path d="M13 8C13 8.5523 12.5523 9 12 9C11.4477 9 11 8.5523 11 8C11 7.4477 11.4477 7 12 7C12.5523 7 13 7.4477 13 8Z" fill="currentColor" stroke="none"/></symbol>
    <symbol id="kr-keyline-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12C21 16.9706 16.9706 21 12 21C7.0294 21 3 16.9706 3 12C3 7.0294 7.0294 3 12 3C9.9618 5.5477 10.1652 9.2206 12.4723 11.5277C14.7794 13.8348 18.4523 14.0382 21 12Z" fill="none"/></symbol>
    <symbol id="kr-keyline-play" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.00351C4 2.379713 5.83285 1.432756 7.157224 2.372305L19.578612 11.184397C20.140462 11.58299 20.140462 12.41701 19.578612 12.815603L7.157224 21.627695C5.83285 22.567244 4 21.620287 4 19.99649Z"/></symbol>
    <symbol id="kr-keyline-refresh" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2117 13.9407C3.071 13.3034 3 12.6527 3 12C3 7.0294 7.0294 3 12 3C14.4831 3 16.8559 4.0259 18.5568 5.8349M19.7143 3L19.2707 6.105C19.2317 6.3784 18.9784 6.5683 18.705 6.5293L15.6 6.0857M20.7883 10.0593C20.929 10.6966 21 11.3473 21 12C21 16.9706 16.9706 21 12 21C9.5169 21 7.1441 19.9741 5.4432 18.1651M4.2857 21L4.7293 17.895C4.7683 17.6216 5.0216 17.4317 5.295 17.4707L8.4 17.9143"/></symbol>
    <symbol id="kr-keyline-save" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3V14M8 10L12 14L16 10M4 18V19C4 20.1046 4.89543 21 6 21H18C19.1046 21 20 20.1046 20 19V18"/></symbol>
    <symbol id="kr-keyline-shield" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.18251 5.16845C7.83034 4.85425 9.82952 3.53222 11.0242 2.37315C11.537 1.87562 12.463 1.87562 12.9758 2.37315C14.1705 3.53222 16.1697 4.85425 18.8175 5.16845C19.4672 5.24554 20 5.75056 20 6.38285V12.5708C20 14.3452 19.7111 16.1513 18.612 17.5729C17.4097 19.1277 15.5033 20.8703 12.8298 21.8525C12.2945 22.0492 11.7055 22.0492 11.1702 21.8525C8.49668 20.8703 6.59026 19.1277 5.38804 17.5729C4.28885 16.1513 4 14.3452 4 12.5708V6.38285C4 5.75056 4.53284 5.24554 5.18251 5.16845ZM8 12L10.6667 15L16 9"/></symbol>
    <symbol id="kr-keyline-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 12C16.5 14.4854 14.4854 16.5 12 16.5C9.5147 16.5 7.5 14.4854 7.5 12C7.5 9.5147 9.5147 7.5 12 7.5C14.4854 7.5 16.5 9.5147 16.5 12ZM20.5 12L22 12M18.0104 18.0104L19.0711 19.0711M12 20.5L12 22M5.9896 18.0104L4.9289 19.0711M3.5 12L2 12M5.9896 5.9896L4.9289 4.9289M12 3.5L12 2M18.0104 5.9896L19.0711 4.9289"/></symbol>
    <symbol id="kr-keyline-trash" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2H14M4 7H20M6 7H18V19C18 20.6569 16.6569 22 15 22H9C7.34315 22 6 20.6569 6 19V7Z"/></symbol>
    <symbol id="kr-keyline-zap" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12H5L8 4L16 20L19 12H22" fill="none"/></symbol>
  </defs>
</svg>
SVG;
    }
}
