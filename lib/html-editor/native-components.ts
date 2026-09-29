import type { LocalizationLocale } from './localization';

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface NativeLightboxMarkup {
  fullSource?: string;
  thumbnailSource?: string;
  alt?: string;
}

export function buildNativeLightboxMarkup(model: NativeLightboxMarkup = {}) {
  const fullSource = model.fullSource?.trim() || '';
  const thumbnailSource = model.thumbnailSource?.trim() || '';
  const alt = model.alt?.trim() || '';
  const thumbnailAttribute = thumbnailSource
    ? ` src="${escapeAttribute(thumbnailSource)}"`
    : ' data-kodety-empty-image';

  return `<div data-label="Lightbox" data-incode-component="lightbox" data-kodety-lightbox data-kodety-lightbox-src="${escapeAttribute(fullSource)}" style="position: relative; display: block; box-sizing: border-box; width: 100%; max-width: 760px; border-radius: 18px; overflow: hidden; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <button type="button" data-label="Open Lightbox" data-kodety-lightbox-open aria-label="Abrir imagem em tela cheia" style="appearance: none; -webkit-appearance: none; display: block; width: 100%; margin: 0; padding: 0; border: 0; border-radius: inherit; background: transparent; color: inherit; cursor: zoom-in; overflow: hidden;">
    <img data-label="Lightbox Thumbnail" data-kodety-lightbox-thumb${thumbnailAttribute} alt="${escapeAttribute(alt)}" aria-label="${escapeAttribute(alt || 'Lightbox image placeholder')}" loading="lazy" style="display: block; box-sizing: border-box; width: 100%; min-height: 320px; aspect-ratio: 16 / 9; border: 1px solid #e5e5e5; border-radius: inherit; background-color: #ededed; background-image: repeating-linear-gradient(135deg, transparent 0 18px, rgba(255,255,255,.72) 18px 20px); object-fit: cover;">
  </button>
  <dialog data-label="Lightbox Dialog" data-kodety-lightbox-dialog aria-label="${escapeAttribute(alt || 'Visualização ampliada')}" style="position: fixed; inset: 0; width: 100vw; max-width: none; height: 100dvh; max-height: none; margin: 0; padding: 0; border: 0; background: transparent; overflow: hidden;">
    <button type="button" data-kodety-lightbox-close aria-label="Fechar lightbox" style="position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; background: rgba(10, 10, 10, .82); cursor: zoom-out;"></button>
    <div style="position: absolute; inset: 0; display: grid; padding: clamp(24px, 5vw, 72px); place-items: center; pointer-events: none;">
      <img data-label="Lightbox Full Image" data-kodety-lightbox-image alt="${escapeAttribute(alt)}" style="display: block; width: auto; max-width: 92vw; height: auto; max-height: 88dvh; min-width: min(320px, 72vw); min-height: min(220px, 45vh); border-radius: 16px; background-color: #202020; object-fit: contain; box-shadow: 0 24px 80px rgba(0, 0, 0, .48); pointer-events: auto;">
      <button type="button" data-kodety-lightbox-close aria-label="Fechar lightbox" style="position: absolute; top: 20px; right: 20px; display: inline-grid; width: 44px; height: 44px; padding: 0; place-items: center; border: 1px solid rgba(255,255,255,.22); border-radius: 999px; background: rgba(24,24,24,.72); color: #ffffff; font: 400 26px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer; pointer-events: auto;">×</button>
    </div>
  </dialog>
</div>`;
}

export interface NativeOverlayMarkup {
  id?: string;
  triggerLabel?: string;
  title?: string;
  description?: string;
}

function nativeOverlayId(value: string | undefined, fallback: string) {
  const normalized = (value || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

const OVERLAY_FONT_STYLE = "font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;";
const OVERLAY_TRIGGER_STYLE = `appearance: none; -webkit-appearance: none; display: inline-flex; min-height: 44px; padding: 10px 16px; align-items: center; justify-content: center; gap: 8px; border: 1px solid #262626; border-radius: 12px; background: #262626; color: #ffffff; font: 600 14px/1.3 Inter, ui-sans-serif, system-ui, sans-serif; cursor: pointer;`;
const OVERLAY_CLOSE_STYLE = `appearance: none; -webkit-appearance: none; display: inline-grid; width: 40px; height: 40px; padding: 0; place-items: center; border: 1px solid #dedede; border-radius: 999px; background: #ffffff; color: #262626; font: 400 22px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer;`;
const OVERLAY_BACKDROP_STYLE = `position: fixed; z-index: 2147483646; inset: 0; width: 100%; height: 100%; margin: 0; padding: 0; border: 0; background: rgba(10, 10, 10, .56); cursor: default;`;

export function buildNativeModalMarkup(model: NativeOverlayMarkup = {}) {
  const id = nativeOverlayId(model.id, 'kodety-modal');
  const title = model.title?.trim() || 'Modal title';
  const description = model.description?.trim() || 'Add supporting content and actions to this modal.';
  const triggerLabel = model.triggerLabel?.trim() || 'Open modal';

  return `<div data-label="Modal" data-incode-component="overlay-modal" data-kodety-overlay="modal" style="position: relative; display: block; box-sizing: border-box; ${OVERLAY_FONT_STYLE}">
  <button type="button" data-label="Modal Trigger" data-kodety-overlay-trigger data-kodety-overlay-open aria-haspopup="dialog" aria-expanded="false" aria-controls="${escapeAttribute(id)}" style="${OVERLAY_TRIGGER_STYLE}">${escapeText(triggerLabel)}</button>
  <button type="button" data-label="Modal Backdrop" data-kodety-overlay-backdrop data-kodety-overlay-close aria-label="Close modal" hidden style="${OVERLAY_BACKDROP_STYLE}"></button>
  <section id="${escapeAttribute(id)}" data-label="Modal Surface" data-kodety-overlay-surface role="dialog" aria-modal="true" aria-labelledby="${escapeAttribute(id)}-title" aria-describedby="${escapeAttribute(id)}-description" tabindex="-1" hidden style="position: fixed; z-index: 9999; top: 50%; left: 50%; display: grid; box-sizing: border-box; width: min(560px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); padding: 28px; gap: 20px; border: 1px solid #dedede; border-radius: 20px; background: #ffffff; color: #171717; box-shadow: 0 28px 90px rgba(0, 0, 0, .28); transform: translate(-50%, -50%); overflow: auto; ${OVERLAY_FONT_STYLE}">
    <header data-label="Modal Header" style="display: flex; align-items: flex-start; justify-content: space-between; gap: 20px;">
      <div style="min-width: 0;">
        <h2 id="${escapeAttribute(id)}-title" style="margin: 0; font-size: 24px; line-height: 1.2;">${escapeText(title)}</h2>
        <p id="${escapeAttribute(id)}-description" style="margin: 8px 0 0; color: #666666; font-size: 15px; line-height: 1.55;">${escapeText(description)}</p>
      </div>
      <button type="button" data-label="Close Modal" data-kodety-overlay-close aria-label="Close modal" style="${OVERLAY_CLOSE_STYLE}">×</button>
    </header>
    <div data-label="Modal Content" style="min-height: 120px; padding: 20px; border-radius: 14px; background: #f5f5f5; color: #666666; line-height: 1.55;">Modal content</div>
    <footer data-label="Modal Actions" style="display: flex; justify-content: flex-end; gap: 10px;">
      <button type="button" data-kodety-overlay-close style="appearance: none; min-height: 42px; padding: 9px 15px; border: 1px solid #dedede; border-radius: 11px; background: #ffffff; color: #262626; font-family: inherit; font-size: 14px; font-weight: 600; line-height: 1.3; cursor: pointer;">Cancel</button>
      <button type="button" style="${OVERLAY_TRIGGER_STYLE} min-height: 42px;">Continue</button>
    </footer>
  </section>
</div>`;
}

export function buildNativeDrawerMarkup(model: NativeOverlayMarkup = {}) {
  const id = nativeOverlayId(model.id, 'kodety-drawer');
  const title = model.title?.trim() || 'Drawer title';
  const description = model.description?.trim() || 'Use this surface for navigation, filters, a cart, or contextual details.';
  const triggerLabel = model.triggerLabel?.trim() || 'Open drawer';

  return `<div data-label="Drawer" data-incode-component="overlay-drawer" data-kodety-overlay="drawer" style="position: relative; display: block; box-sizing: border-box; ${OVERLAY_FONT_STYLE}">
  <button type="button" data-label="Drawer Trigger" data-kodety-overlay-trigger data-kodety-overlay-open aria-haspopup="dialog" aria-expanded="false" aria-controls="${escapeAttribute(id)}" style="${OVERLAY_TRIGGER_STYLE}">${escapeText(triggerLabel)}</button>
  <button type="button" data-label="Drawer Backdrop" data-kodety-overlay-backdrop data-kodety-overlay-close aria-label="Close drawer" hidden style="${OVERLAY_BACKDROP_STYLE}"></button>
  <aside id="${escapeAttribute(id)}" data-label="Drawer Surface" data-kodety-overlay-surface role="dialog" aria-modal="true" aria-labelledby="${escapeAttribute(id)}-title" aria-describedby="${escapeAttribute(id)}-description" tabindex="-1" hidden style="position: fixed; z-index: 9999; top: 0; right: 0; display: grid; box-sizing: border-box; width: min(420px, 100vw); height: 100dvh; grid-template-rows: auto minmax(0, 1fr) auto; border-left: 1px solid #dedede; background: #ffffff; color: #171717; box-shadow: -24px 0 70px rgba(0, 0, 0, .22); ${OVERLAY_FONT_STYLE}">
    <header data-label="Drawer Header" style="display: flex; padding: 22px; align-items: flex-start; justify-content: space-between; gap: 20px; border-bottom: 1px solid #e5e5e5;">
      <div style="min-width: 0;">
        <h2 id="${escapeAttribute(id)}-title" style="margin: 0; font-size: 22px; line-height: 1.2;">${escapeText(title)}</h2>
        <p id="${escapeAttribute(id)}-description" style="margin: 7px 0 0; color: #666666; font-size: 14px; line-height: 1.5;">${escapeText(description)}</p>
      </div>
      <button type="button" data-label="Close Drawer" data-kodety-overlay-close aria-label="Close drawer" style="${OVERLAY_CLOSE_STYLE}">×</button>
    </header>
    <div data-label="Drawer Content" style="min-height: 0; padding: 22px; color: #666666; line-height: 1.55; overflow: auto;">Drawer content</div>
    <footer data-label="Drawer Actions" style="padding: 18px 22px; border-top: 1px solid #e5e5e5;">
      <button type="button" data-kodety-overlay-close style="${OVERLAY_TRIGGER_STYLE} width: 100%;">Done</button>
    </footer>
  </aside>
</div>`;
}

export function buildNativePopoverMarkup(model: NativeOverlayMarkup = {}) {
  const id = nativeOverlayId(model.id, 'kodety-popover');
  const title = model.title?.trim() || 'Popover title';
  const description = model.description?.trim() || 'Add compact contextual content without leaving the page.';
  const triggerLabel = model.triggerLabel?.trim() || 'Open popover';

  return `<div data-label="Popover" data-incode-component="overlay-popover" data-kodety-overlay="popover" style="position: relative; display: inline-block; box-sizing: border-box; ${OVERLAY_FONT_STYLE}">
  <button type="button" data-label="Popover Trigger" data-kodety-overlay-trigger data-kodety-overlay-open aria-haspopup="dialog" aria-expanded="false" aria-controls="${escapeAttribute(id)}" style="${OVERLAY_TRIGGER_STYLE}">${escapeText(triggerLabel)}</button>
  <section id="${escapeAttribute(id)}" data-label="Popover Surface" data-kodety-overlay-surface role="dialog" aria-modal="false" aria-labelledby="${escapeAttribute(id)}-title" aria-describedby="${escapeAttribute(id)}-description" tabindex="-1" hidden style="position: absolute; z-index: 120; top: calc(100% + 8px); left: 0; display: grid; box-sizing: border-box; width: min(320px, calc(100vw - 24px)); padding: 18px; gap: 12px; border: 1px solid #dedede; border-radius: 15px; background: #ffffff; color: #171717; box-shadow: 0 18px 48px rgba(0, 0, 0, .16); ${OVERLAY_FONT_STYLE}">
    <header style="display: flex; align-items: flex-start; justify-content: space-between; gap: 14px;">
      <div style="min-width: 0;">
        <h2 id="${escapeAttribute(id)}-title" style="margin: 0; font-size: 16px; line-height: 1.3;">${escapeText(title)}</h2>
        <p id="${escapeAttribute(id)}-description" style="margin: 6px 0 0; color: #666666; font-size: 13px; line-height: 1.5;">${escapeText(description)}</p>
      </div>
      <button type="button" data-label="Close Popover" data-kodety-overlay-close aria-label="Close popover" style="${OVERLAY_CLOSE_STYLE} width: 32px; height: 32px; font-size: 18px;">×</button>
    </header>
    <div data-label="Popover Content" style="padding: 12px; border-radius: 10px; background: #f5f5f5; color: #666666; font-size: 13px; line-height: 1.5;">Popover content</div>
  </section>
</div>`;
}

export function buildNativeTooltipMarkup(model: NativeOverlayMarkup = {}) {
  const id = nativeOverlayId(model.id, 'kodety-tooltip');
  const content = model.description?.trim() || model.title?.trim() || 'Helpful information about this control.';
  const triggerLabel = model.triggerLabel?.trim() || 'More information';

  return `<span data-label="Tooltip" data-incode-component="overlay-tooltip" data-kodety-overlay="tooltip" style="position: relative; display: inline-flex; box-sizing: border-box; ${OVERLAY_FONT_STYLE}">
  <button type="button" data-label="Tooltip Trigger" data-kodety-overlay-trigger data-kodety-overlay-open aria-describedby="${escapeAttribute(id)}" aria-expanded="false" style="${OVERLAY_TRIGGER_STYLE}">${escapeText(triggerLabel)}</button>
  <span id="${escapeAttribute(id)}" data-label="Tooltip Surface" data-kodety-overlay-surface role="tooltip" hidden style="position: absolute; z-index: 120; bottom: calc(100% + 8px); left: 50%; display: block; box-sizing: border-box; width: max-content; max-width: min(280px, calc(100vw - 24px)); padding: 9px 11px; border-radius: 9px; background: #171717; color: #ffffff; box-shadow: 0 10px 28px rgba(0, 0, 0, .2); font-size: 12px; line-height: 1.45; text-align: left; transform: translateX(-50%);">${escapeText(content)}</span>
</span>`;
}

export function buildNativeCheckoutOverlayMarkup(model: NativeOverlayMarkup = {}) {
  const id = nativeOverlayId(model.id, 'kodety-checkout-overlay');
  const title = model.title?.trim() || 'Secure checkout';
  const description = model.description?.trim() || 'Review your order and continue to payment.';
  const triggerLabel = model.triggerLabel?.trim() || 'Open checkout';

  return `<div data-label="Checkout Overlay" data-incode-component="checkout-overlay" data-kodety-overlay="checkout" data-kodefy-checkout-overlay style="position: relative; display: block; box-sizing: border-box; ${OVERLAY_FONT_STYLE}">
  <button type="button" data-label="Checkout Trigger" data-kodety-overlay-trigger data-kodefy-checkout aria-haspopup="dialog" aria-expanded="false" aria-controls="${escapeAttribute(id)}" style="${OVERLAY_TRIGGER_STYLE}">${escapeText(triggerLabel)}</button>
  <button type="button" data-label="Checkout Backdrop" data-kodety-overlay-backdrop data-kodety-overlay-close aria-label="Close checkout" hidden style="${OVERLAY_BACKDROP_STYLE}"></button>
  <section id="${escapeAttribute(id)}" data-label="Checkout Surface" data-kodety-overlay-surface role="dialog" aria-modal="true" aria-labelledby="${escapeAttribute(id)}-title" aria-describedby="${escapeAttribute(id)}-description" tabindex="-1" hidden style="position: fixed; z-index: 9999; inset: 16px; display: grid; box-sizing: border-box; width: min(980px, calc(100vw - 32px)); max-width: none; height: min(720px, calc(100dvh - 32px)); margin: auto; grid-template-rows: auto minmax(0, 1fr); border: 1px solid #dedede; border-radius: 22px; background: #ffffff; color: #171717; box-shadow: 0 30px 100px rgba(0, 0, 0, .3); overflow: hidden; ${OVERLAY_FONT_STYLE}">
    <header data-label="Checkout Header" style="display: flex; padding: 20px 24px; align-items: flex-start; justify-content: space-between; gap: 20px; border-bottom: 1px solid #e5e5e5;">
      <div style="min-width: 0;">
        <h2 id="${escapeAttribute(id)}-title" style="margin: 0; font-size: 22px; line-height: 1.2;">${escapeText(title)}</h2>
        <p id="${escapeAttribute(id)}-description" style="margin: 7px 0 0; color: #666666; font-size: 14px; line-height: 1.5;">${escapeText(description)}</p>
      </div>
      <button type="button" data-label="Close Checkout" data-kodety-overlay-close aria-label="Close checkout" style="${OVERLAY_CLOSE_STYLE}">×</button>
    </header>
    <div data-label="Checkout Layout" style="display: grid; min-height: 0; grid-template-columns: minmax(0, 1fr) minmax(280px, .72fr); overflow: auto;">
      <div data-label="Checkout Items" data-kodefy-checkout-items style="display: grid; align-content: start; padding: clamp(22px, 4vw, 42px); gap: 14px;">
        <article data-label="Checkout Item" data-kodefy-checkout-item data-kodefy-template hidden style="display: grid; padding: 14px; grid-template-columns: 72px minmax(0, 1fr) auto; align-items: center; gap: 14px; border: 1px solid #e5e5e5; border-radius: 14px;">
          <img data-kodefy-checkout-item-image alt="" style="display: block; width: 72px; height: 72px; border-radius: 10px; background: #f0f0f0; object-fit: cover;">
          <div style="min-width: 0;"><strong data-kodefy-checkout-item-title style="display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Product</strong><span data-kodefy-checkout-item-options style="display: block; margin-top: 5px; color: #737373; font-size: 13px;">Option · 1 item</span></div>
          <strong data-kodefy-checkout-item-price>R$ 0,00</strong>
        </article>
      </div>
      <aside data-label="Order Summary" aria-label="Order summary" style="display: grid; padding: clamp(22px, 4vw, 42px); align-content: start; border-left: 1px solid #e5e5e5; background: #f7f7f7;">
        <span data-kodefy-checkout-provider style="color: #737373; font-size: 12px; text-transform: uppercase;">Secure provider</span>
        <h3 style="margin: 8px 0 0; font-size: 18px; line-height: 1.3;">Order summary</h3>
        <div style="display: flex; margin-top: 18px; padding: 18px 0; align-items: center; justify-content: space-between; gap: 16px; border-block: 1px solid #dedede;"><strong>Total</strong><strong data-kodefy-checkout-total style="font-size: 22px;">R$ 0,00</strong></div>
        <p data-kodefy-checkout-message aria-live="polite" style="margin: 16px 0 0; color: #666666; font-size: 13px; line-height: 1.5;">You will continue to the secure payment environment.</p>
        <button type="button" data-kodefy-checkout-confirm style="${OVERLAY_TRIGGER_STYLE} width: 100%; min-height: 50px; margin-top: 22px;">Continue to payment</button>
        <button type="button" data-kodety-overlay-close style="appearance: none; min-height: 42px; margin-top: 8px; border: 0; background: transparent; color: #666666; font-family: inherit; cursor: pointer;">Return to cart</button>
      </aside>
    </div>
  </section>
</div>`;
}

const GLOBE_ICON = `<svg data-label="Language Icon" data-kodety-locale-icon viewBox="0 0 24 24" aria-hidden="true" style="display: block; width: 20px; height: 20px; color: currentColor; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3c2.3 2.5 3.5 5.5 3.5 9S14.3 18.5 12 21M12 3C9.7 5.5 8.5 8.5 8.5 12s1.2 6.5 3.5 9"></path></svg>`;
const CHEVRON_ICON = `<svg data-label="Language Chevron" data-kodety-locale-chevron viewBox="0 0 24 24" aria-hidden="true" style="display: block; width: 18px; height: 18px; color: #8a8a8a; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round;"><path d="m6 9 6 6 6-6"></path></svg>`;

export function buildNativeLocaleSelectorMarkup(
  locales: Array<Pick<LocalizationLocale, 'code' | 'name' | 'enabled' | 'direction'>> = [],
  activeLocale?: string,
) {
  const enabled = locales.filter(locale => locale.enabled !== false && locale.code);
  const available = enabled.length
    ? enabled
    : [{ code: activeLocale || 'original', name: 'Original', enabled: true, direction: 'ltr' as const }];
  const current = available.find(locale => locale.code === activeLocale) || available[0];
  const optionStyle = 'display: flex; box-sizing: border-box; min-height: 38px; padding: 8px 10px; align-items: center; border-radius: 9px; color: #303030; font-size: 14px; line-height: 1.35; text-decoration: none;';
  const options = available.map(locale => `<a href="#" data-label="${escapeAttribute(locale.name)}" data-kodety-locale-option hreflang="${escapeAttribute(locale.code)}" lang="${escapeAttribute(locale.code)}" dir="${escapeAttribute(locale.direction || 'ltr')}"${locale.code === current.code ? ' aria-current="page"' : ''} style="${optionStyle}">${escapeText(locale.name || locale.code)}</a>`).join('');

  return `<details data-label="Language Selector" data-incode-component="locales-list" data-kodety-locale-selector style="position: relative; display: inline-block; box-sizing: border-box; width: 100%; max-width: 240px; color: #151515; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <summary data-label="Language Trigger" data-kodety-locale-trigger aria-label="Selecionar idioma" style="display: grid; box-sizing: border-box; width: 100%; min-height: 48px; padding: 10px 14px; grid-template-columns: 20px minmax(0, 1fr) 18px; align-items: center; gap: 10px; border: 1px solid transparent; border-radius: 14px; background: #ededed; color: #151515; font-size: 15px; font-weight: 500; line-height: 1.25; list-style: none; cursor: pointer; user-select: none;">
    ${GLOBE_ICON}
    <span data-label="Current Language" data-kodety-locale-current style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeText(current.name || current.code)}</span>
    ${CHEVRON_ICON}
  </summary>
  <div data-label="Language Options" data-kodety-locale-options style="position: absolute; z-index: 60; top: calc(100% + 6px); left: 0; display: grid; box-sizing: border-box; width: 100%; padding: 4px; gap: 2px; border: 1px solid #dedede; border-radius: 12px; background: #ffffff; box-shadow: 0 14px 34px rgba(0, 0, 0, .13); overflow: hidden;">
    ${options}
  </div>
</details>`;
}
