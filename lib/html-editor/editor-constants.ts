import {
  buildNativeCheckoutOverlayMarkup,
  buildNativeDrawerMarkup,
  buildNativeLightboxMarkup,
  buildNativeLocaleSelectorMarkup,
  buildNativeModalMarkup,
  buildNativePopoverMarkup,
  buildNativeTooltipMarkup,
} from '@/lib/html-editor/native-components';
import type { MembershipFormPurpose } from '@/lib/html-editor/membership';

export const MAIN_CANVAS_BREAKPOINT_TABS = [
  { id: 'base', label: 'Desktop', icon: 'desktop' },
  { id: 'tablet', label: 'Tablet', icon: 'tablet' },
  { id: 'mobile', label: 'Mobile', icon: 'mobile' },
  { id: 'wide', label: 'Wide', icon: 'wide' },
  { id: 'notebook', label: 'Notebook', icon: 'notebook' },
] as const;

export const MIN_CANVAS_VIEWPORT_SIZE = 240;

export const MAX_CANVAS_VIEWPORT_WIDTH = 16384;

export const MAX_CANVAS_VIEWPORT_HEIGHT = 10000;

export const MOTION_TIMELINE_HEIGHT_PREFERENCE = 'html-editor:motion-timeline-height';

export const MOTION_TIMELINE_MIN_HEIGHT = 220;

export const MOTION_TIMELINE_DEFAULT_HEIGHT = 320;

export const MOTION_TIMELINE_DEFAULT_MAX_HEIGHT = 520;

export { TOAST_PROPS } from './toast-config';

export const SIDEBAR_LIMITS = {
  left: { min: 196, max: 420, initial: 220 },
  right: { min: 224, max: 640, initial: 248 },
} as const;

export const TOPBAR_ICON_CLASS =
  'relative size-8 shrink-0 rounded-[6px] p-0 text-[var(--kodety-text-tertiary)] hover:bg-white/[0.055] hover:text-[var(--kodety-text)] focus-visible:bg-white/[0.055] [&_svg]:!size-4 after:pointer-events-none after:absolute after:left-1/2 after:top-[calc(100%+7px)] after:z-[120] after:-translate-x-1/2 after:whitespace-nowrap after:rounded-[6px] after:border after:border-white/10 after:bg-[#181818] after:px-2 after:py-1 after:text-[10px] after:font-medium after:leading-none after:text-zinc-100 after:opacity-0 after:shadow-xl after:transition-opacity after:content-[attr(data-tooltip)] hover:after:opacity-100 focus-visible:after:opacity-100';

export const SIDEBAR_RAIL_BUTTON_CLASS =
  'relative grid size-9 shrink-0 place-items-center rounded-[7px] text-[var(--kodety-text-tertiary)] outline-none transition-colors hover:bg-white/[0.055] hover:text-[var(--kodety-text)] focus-visible:ring-1 focus-visible:ring-[var(--kodety-focus)] [&_svg]:size-[18px] after:pointer-events-none after:absolute after:left-[calc(100%+8px)] after:top-1/2 after:z-[160] after:-translate-y-1/2 after:whitespace-nowrap after:rounded-[6px] after:border after:border-white/10 after:bg-[#181818] after:px-2 after:py-1.5 after:text-[10px] after:font-medium after:leading-none after:text-zinc-100 after:opacity-0 after:shadow-xl after:transition-opacity after:content-[attr(data-tooltip)] hover:after:opacity-100 focus-visible:after:opacity-100';

export const CANVAS_HUD_TOOLTIP_CLASS = 'relative after:pointer-events-none after:absolute after:bottom-[calc(100%+8px)] after:left-1/2 after:z-[140] after:-translate-x-1/2 after:whitespace-nowrap after:rounded-[6px] after:border after:border-white/10 after:bg-[#181818] after:px-2 after:py-1.5 after:text-[10px] after:font-medium after:leading-none after:text-zinc-100 after:opacity-0 after:shadow-xl after:transition-opacity after:content-[attr(data-tooltip)] hover:after:opacity-100 focus-visible:after:opacity-100';

export const HISTORY_LIMIT = 50;

export const INFINITE_CANVAS_PREFERENCE = 'html-editor:infinite-canvas-enabled';

export const MOBILE_BUILDER_MEDIA_QUERY = '(max-width: 767px), (max-height: 767px) and (pointer: coarse)';

export const FOLDER_SYNC_AUTOSAVE_IDLE_MS = 2500;

// Background WordPress persistence is a maximum interval anchored to the first
// unsaved edit. Later keystrokes replace the pending snapshot without pushing
// this deadline forward. Manual Save/navigation/Publish flush immediately.
export const WORDPRESS_DRAFT_AUTOSAVE_INTERVAL_MS = 30_000;

// Opening/importing a project already inflates the ZIP and starts decoding its
// visible assets. Keep a short startup grace, then persist continuously; a
// ten-minute gate left both WordPress and IndexedDB without a recovery point.
export const PROJECT_FIRST_AUTOSAVE_DELAY_MS = 15_000;

// Delta is intentionally bounded below common PHP/proxy request limits. A
// larger replacement uses the chunked ZIP compatibility transport before any
// delta request is sent, so the decision is unambiguous and safe to replay.
export const WORDPRESS_DRAFT_DELTA_MAX_RAW_BYTES = 6 * 1024 * 1024;

export const WORDPRESS_DRAFT_DELTA_MAX_BODY_BYTES = 10 * 1024 * 1024;

export const WORDPRESS_DRAFT_DELTA_MAX_OPERATIONS = 512;

export const WORDPRESS_DRAFT_DELTA_MAX_PATH_BYTES = 1024;

// Keep every request comfortably below common 64 MB PHP/Nginx body limits.
// The server reassembles and validates the exact ZIP before replacing a draft.
export const WORDPRESS_DRAFT_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

// Some managed hosts return a generic 500 instead of 413 when their proxy
// rejects a request body. Retry the same archive with bounded 1 MB parts before
// surfacing the persistence error to the editor.
export const WORDPRESS_DRAFT_UPLOAD_FALLBACK_CHUNK_BYTES = 1 * 1024 * 1024;

export const WORDPRESS_DRAFT_UPLOAD_CHUNK_THRESHOLD_BYTES = 8 * 1024 * 1024;

export const TEXT_EDIT_AUTOSAVE_IDLE_MS = 2000;

export const WORDPRESS_DRAFT_IDLE_DEADLINE_MS = 1500;

export const WORDPRESS_DRAFT_RATE_LIMIT_FLOOR_MS = 15_000;

export const WORDPRESS_DRAFT_RETRY_MAX_MS = 60_000;

// IndexedDB structured-clones every Uint8Array in the project. Running that
// clone while the first canvas is decoding images can double the memory peak
// and stall Chromium's renderer, so recovery waits for a real quiet window.
// Explicit Save remains immediate; automatic pagehide writes respect the
// initial WordPress interval so opening a project never triggers this clone.
export const LOCAL_RECOVERY_AUTOSAVE_IDLE_MS = 4000;

export const LARGE_PROJECT_LOCAL_RECOVERY_AUTOSAVE_IDLE_MS = 12000;

export const PREVIEW_REVIEW_SYNC_IDLE_MS = 1800;

export const PREVIEW_REVIEW_SYNC_MAX_WAIT_MS = 8000;

export const INFINITE_CANVAS_LOADING_MIN_MS = 180;

export const INFINITE_CANVAS_LOADING_MAX_MS = 900;

export const CANVAS_ACTIVE_EDIT_GRACE_MS = 240;

export const CANVAS_MUTATION_REPLAY_MS = 60;

export const CANVAS_MUTATION_MAX_ATTEMPTS = 6;

export const CANVAS_MUTATION_IDLE_RETRY_MS = 80;

export const CANVAS_MUTATION_REPAIR_RETRY_MS = 600;

export const CANVAS_CANONICAL_FALLBACK_MS = 450;

export const CANVAS_CANONICAL_FALLBACK_RETRY_MS = 100;

export const MEMBERSHIP_FORM_INSERTS: Record<string, MembershipFormPurpose> = {
  'membership-login': 'login',
  'membership-register': 'register',
  'membership-forgot-password': 'forgot-password',
  'membership-reset-password': 'reset-password',
  'membership-profile': 'profile',
  'membership-logout': 'logout',
};

export const NEUTRAL_FONT_STYLE =
  'font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;';

export const NEUTRAL_SURFACE_STYLE = `box-sizing: border-box; width: 100%; max-width: 560px; padding: 32px; border: 1px solid #e5e5e5; border-radius: 20px; background: #ffffff; color: #171717; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06); ${NEUTRAL_FONT_STYLE}`;

export const NEUTRAL_CONTROL_STYLE =
  'appearance: none; -webkit-appearance: none; box-sizing: border-box; display: block; width: 100%; min-height: 52px; margin: 0; padding: 13px 16px; border: 1px solid #dedede; border-radius: 14px; outline: none; background: #f5f5f5; color: #171717; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03); font: inherit; font-size: 16px; line-height: 1.4;';

export const NEUTRAL_SELECT_STYLE = `${NEUTRAL_CONTROL_STYLE} padding-right: 44px; background-image: linear-gradient(45deg, transparent 50%, #737373 50%), linear-gradient(135deg, #737373 50%, transparent 50%); background-position: calc(100% - 19px) 50%, calc(100% - 14px) 50%; background-size: 5px 5px, 5px 5px; background-repeat: no-repeat;`;

export const NEUTRAL_BUTTON_STYLE =
  'appearance: none; -webkit-appearance: none; box-sizing: border-box; display: inline-flex; min-height: 52px; margin: 0; padding: 13px 22px; align-items: center; justify-content: center; gap: 8px; border: 1px solid #262626; border-radius: 14px; background: #2b2b2b; color: #ffffff; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12); font: inherit; font-size: 15px; font-weight: 600; line-height: 1.3; text-align: center; text-decoration: none; cursor: pointer;';

export const NEUTRAL_SECONDARY_BUTTON_STYLE =
  'appearance: none; -webkit-appearance: none; box-sizing: border-box; display: inline-flex; min-height: 44px; margin: 0; padding: 10px 16px; align-items: center; justify-content: center; gap: 8px; border: 1px solid #dedede; border-radius: 12px; background: #ffffff; color: #262626; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04); font: inherit; font-size: 14px; font-weight: 550; line-height: 1.3; text-decoration: none; cursor: pointer;';

export const NEUTRAL_LABEL_STYLE =
  'display: flex; min-width: 0; flex-direction: column; gap: 8px; color: #737373; font: inherit; font-size: 14px; font-weight: 500; line-height: 1.35;';

export const NEUTRAL_MEDIA_STYLE =
  'display: block; box-sizing: border-box; width: 100%; min-height: 240px; border: 1px solid #e5e5e5; border-radius: 18px; background: #f5f5f5; object-fit: cover; overflow: hidden;';

export const NEUTRAL_IMAGE_PLACEHOLDER_STYLE =
  'display: block; box-sizing: border-box; width: 100%; height: 320px; min-height: 240px; border: 1px solid #dddddd; border-radius: 16px; background-color: #eeeeee; background-image: repeating-linear-gradient(135deg, transparent 0, transparent 20px, rgba(255, 255, 255, 0.72) 20px, rgba(255, 255, 255, 0.72) 22px); object-fit: cover; overflow: hidden;';

export const ELEMENT_MARKUP: Record<string, string> = {
  frame:
    '<div data-label="Frame" style="position: relative; box-sizing: border-box; width: 100%; min-height: 600px; padding: 24px;"></div>',
  stack:
    '<div data-label="Stack" style="display: flex; box-sizing: border-box; width: 100%; min-height: 600px; flex-direction: column; gap: 16px; padding: 8px;"></div>',
  row: '<div data-label="Row" style="display: flex; box-sizing: border-box; width: 100%; min-height: 600px; flex-direction: row; align-items: center; gap: 16px; padding: 8px;"></div>',
  grid: '<div data-label="Grid" style="display: grid; box-sizing: border-box; width: 100%; min-height: 600px; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; padding: 8px;"></div>',
  masonry:
    '<div data-label="Masonry" style="box-sizing: border-box; width: 100%; min-height: 600px; columns: 3; column-gap: 16px; padding: 8px;"></div>',
  header: `<header data-label="Header" style="display: flex; box-sizing: border-box; width: 100%; min-height: 600px; padding: 16px 24px; align-items: center; justify-content: space-between; gap: 24px; border-bottom: 1px solid #e5e5e5; background: #ffffff; color: #171717; ${NEUTRAL_FONT_STYLE}"><strong style="font-size: 17px;">Brand</strong><nav style="display: flex; align-items: center; gap: 20px;"><a href="#" style="color: inherit; text-decoration: none;">Home</a><a href="#" style="color: #737373; text-decoration: none;">About</a></nav></header>`,
  nav: `<nav data-label="Navigation" style="display: flex; box-sizing: border-box; width: 100%; min-height: 600px; padding: 12px; align-items: center; gap: 8px; border: 1px solid #e5e5e5; border-radius: 14px; background: #ffffff; color: #262626; ${NEUTRAL_FONT_STYLE}"><a href="#" style="${NEUTRAL_SECONDARY_BUTTON_STYLE}">Home</a><a href="#" style="padding: 10px 14px; color: #737373; text-decoration: none;">About</a><a href="#" style="padding: 10px 14px; color: #737373; text-decoration: none;">Contact</a></nav>`,
  main: '<main data-label="Main" style="box-sizing: border-box; width: 100%; min-height: 600px; padding: 40px 24px;"></main>',
  section:
    '<section data-label="Section" style="box-sizing: border-box; width: 100%; min-height: 600px; padding: 40px 24px;"></section>',
  article: `<article data-label="Article" style="${NEUTRAL_SURFACE_STYLE} min-height: 600px;"><p style="margin: 0 0 8px; color: #737373; font-size: 13px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;">Article</p><h2 style="margin: 0; font-size: 28px; line-height: 1.15;">A neutral starting point</h2><p style="margin: 14px 0 0; color: #666666; font-size: 16px; line-height: 1.6;">Use this space to introduce your content with a clear hierarchy.</p></article>`,
  aside: `<aside data-label="Aside" style="box-sizing: border-box; width: 100%; min-height: 600px; max-width: 360px; padding: 24px; border: 1px solid #e5e5e5; border-radius: 18px; background: #f7f7f7; color: #171717; ${NEUTRAL_FONT_STYLE}"><strong style="display: block; margin-bottom: 8px;">Related content</strong><p style="margin: 0; color: #737373; line-height: 1.55;">Add supporting information here.</p></aside>`,
  footer: `<footer data-label="Footer" style="display: flex; box-sizing: border-box; width: 100%; min-height: 600px; padding: 24px; align-items: center; justify-content: space-between; gap: 24px; border-top: 1px solid #e5e5e5; background: #ffffff; color: #737373; ${NEUTRAL_FONT_STYLE}"><strong style="color: #171717;">Brand</strong><span>© 2026 All rights reserved.</span></footer>`,
  div: '<div data-label="Div Block" style="box-sizing: border-box; width: 100%; min-height: 120px; padding: 24px;"></div>',
  h1: `<h1 style="margin: 0; color: #171717; font-size: 48px; font-weight: 650; line-height: 1.08; letter-spacing: -0.035em; ${NEUTRAL_FONT_STYLE}">Heading</h1>`,
  h2: `<h2 style="margin: 0; color: #171717; font-size: 36px; font-weight: 650; line-height: 1.12; letter-spacing: -0.025em; ${NEUTRAL_FONT_STYLE}">Heading</h2>`,
  h3: `<h3 style="margin: 0; color: #171717; font-size: 28px; font-weight: 620; line-height: 1.18; letter-spacing: -0.018em; ${NEUTRAL_FONT_STYLE}">Heading</h3>`,
  p: `<p style="max-width: 680px; margin: 0; color: #666666; font-size: 16px; line-height: 1.65; ${NEUTRAL_FONT_STYLE}">Add your text here. Keep it clear, useful, and easy to scan.</p>`,
  span: `<span style="color: #333333; font-size: 16px; line-height: 1.5; ${NEUTRAL_FONT_STYLE}">Text</span>`,
  ul: `<ul style="display: grid; margin: 0; padding: 0; gap: 10px; color: #333333; list-style: none; ${NEUTRAL_FONT_STYLE}"><li style="display: flex; gap: 10px;"><span style="color: #a3a3a3;">•</span>List item</li><li style="display: flex; gap: 10px;"><span style="color: #a3a3a3;">•</span>List item</li></ul>`,
  ol: `<ol style="display: grid; margin: 0; padding-left: 24px; gap: 10px; color: #333333; ${NEUTRAL_FONT_STYLE}"><li>List item</li><li>List item</li></ol>`,
  li: `<li style="color: #333333; font-size: 16px; line-height: 1.5; ${NEUTRAL_FONT_STYLE}">List item</li>`,
  a: `<a href="#" style="color: #262626; font-weight: 550; text-decoration-color: #a3a3a3; text-underline-offset: 4px; ${NEUTRAL_FONT_STYLE}">Link</a>`,
  'link-block': `<a href="#" data-label="Link Block" data-incode-component="link-block" style="${NEUTRAL_SECONDARY_BUTTON_STYLE}"><span>Link Block</span></a>`,
  'text-link': `<a href="#" data-label="Text Link" data-incode-component="text-link" style="color: #262626; font-weight: 550; text-decoration-color: #a3a3a3; text-underline-offset: 4px; ${NEUTRAL_FONT_STYLE}">Text Link</a>`,
  button: `<button type="button" data-label="Button" data-incode-component="button" style="${NEUTRAL_BUTTON_STYLE}"><span>Button</span></button>`,
  'form-button': `<button type="submit" data-label="Form Button" data-incode-component="button" style="${NEUTRAL_BUTTON_STYLE}"><span>Submit</span></button>`,
  'text-block': `<span style="color: #333333; font-size: 16px; line-height: 1.5; ${NEUTRAL_FONT_STYLE}">Text</span>`,
  blockquote: `<blockquote data-label="Block Quote" data-incode-component="blockquote" style="box-sizing: border-box; max-width: 680px; margin: 0; padding: 24px 28px; border-left: 4px solid #a3a3a3; border-radius: 0 16px 16px 0; background: #f7f7f7; color: #333333; font-size: 20px; font-style: italic; line-height: 1.55; ${NEUTRAL_FONT_STYLE}">“A thoughtful quote can give an idea the space it deserves.”</blockquote>`,
  'rich-text': `<div data-label="Rich Text" data-incode-component="rich-text" style="${NEUTRAL_SURFACE_STYLE}"><h2 style="margin: 0; font-size: 30px; line-height: 1.15;">Rich text heading</h2><p style="margin: 14px 0 0; color: #666666; font-size: 16px; line-height: 1.65;">Use this block for longer content with a comfortable reading rhythm.</p></div>`,
  'collection-list': `<div data-label="Collection List" data-incode-component="collection-list" style="display: grid; box-sizing: border-box; width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; ${NEUTRAL_FONT_STYLE}"><article data-label="Collection Item" style="padding: 24px; border: 1px solid #e5e5e5; border-radius: 18px; background: #ffffff;"><p style="margin: 0 0 10px; color: #a3a3a3; font-size: 13px;">Category</p><h3 style="margin: 0; color: #171717; font-size: 20px;">Collection item</h3><p style="margin: 10px 0 0; color: #737373; line-height: 1.55;">Item description.</p></article><article data-label="Collection Item" style="padding: 24px; border: 1px solid #e5e5e5; border-radius: 18px; background: #ffffff;"><p style="margin: 0 0 10px; color: #a3a3a3; font-size: 13px;">Category</p><h3 style="margin: 0; color: #171717; font-size: 20px;">Collection item</h3><p style="margin: 10px 0 0; color: #737373; line-height: 1.55;">Item description.</p></article></div>`,
  img: `<img data-label="Image" data-incode-component="image" data-kodety-empty-image alt="" aria-label="Image placeholder" loading="lazy" style="${NEUTRAL_IMAGE_PLACEHOLDER_STYLE}">`,
  picture: `<picture data-label="Picture" data-incode-component="picture" style="display: block; width: 100%;"><source media="(max-width: 767px)" srcset=""><source media="(min-width: 768px)" srcset=""><img data-kodety-empty-image alt="" aria-label="Image placeholder" loading="lazy" style="${NEUTRAL_IMAGE_PLACEHOLDER_STYLE}"></picture>`,
  video: `<video data-label="Video" data-incode-component="video" controls playsinline style="${NEUTRAL_MEDIA_STYLE}"></video>`,
  audio:
    '<audio data-label="Audio" data-incode-component="audio" controls style="display: block; box-sizing: border-box; width: 100%; max-width: 560px; padding: 8px; border: 1px solid #e5e5e5; border-radius: 16px; background: #f5f5f5;"></audio>',
  embed: `<iframe data-label="Embed" data-incode-component="iframe" title="Embedded content" loading="lazy" srcdoc="<body style='margin:0;display:grid;min-height:100vh;place-items:center;background:#f5f5f5;color:#737373;font:15px system-ui'>Embedded content</body>" style="${NEUTRAL_MEDIA_STYLE}"></iframe>`,
  youtube:
    '<iframe data-label="YouTube" data-incode-component="youtube" title="YouTube video" src="https://www.youtube.com/embed/dQw4w9WgXcQ" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen style="display: block; width: 100%; aspect-ratio: 16 / 9; border: 0; border-radius: 18px; background: #171717;"></iframe>',
  vimeo:
    '<iframe data-label="Vimeo" data-incode-component="vimeo" title="Vimeo video" src="https://player.vimeo.com/video/76979871?controls=1" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share" allowfullscreen style="display: block; width: 100%; aspect-ratio: 16 / 9; border: 0; border-radius: 18px; background: #171717;"></iframe>',
  lottie: `<div data-label="Lottie Animation" data-incode-component="lottie" data-lottie-src="" data-lottie-autoplay="true" data-lottie-loop="true" role="img" aria-label="Lottie animation" style="display: grid; box-sizing: border-box; min-height: 240px; padding: 24px; place-items: center; border: 1px dashed #d4d4d4; border-radius: 18px; background: #f7f7f7; color: #737373; font-size: 15px; ${NEUTRAL_FONT_STYLE}">Lottie Animation</div>`,
  spline: `<iframe data-label="Spline Scene" data-incode-component="spline" data-spline-src="" title="Spline scene" loading="lazy" allow="fullscreen; xr-spatial-tracking" srcdoc="<body style='margin:0;display:grid;min-height:100vh;place-items:center;background:#f5f5f5;color:#737373;font:15px system-ui'>Spline scene</body>" style="${NEUTRAL_MEDIA_STYLE} min-height: 420px;"></iframe>`,
  rive: '<canvas data-label="Rive" data-incode-component="rive" data-rive-src="" data-rive-state-machine="" width="640" height="360" role="img" aria-label="Rive animation" style="display: block; box-sizing: border-box; width: 100%; max-width: 640px; height: auto; aspect-ratio: 16 / 9; border: 1px solid #e5e5e5; border-radius: 18px; background: #f5f5f5;"></canvas>',
  form: `<form data-label="Form Block" data-name="Contact form" data-incode-component="form" data-kodety-form-mode="submission" data-kodety-success-action="message" data-kodety-success-message="Thanks! Your message has been sent." data-kodety-error-message="Something went wrong. Please try again." data-kodety-reset-on-success="true" method="post" enctype="multipart/form-data" style="${NEUTRAL_SURFACE_STYLE} display: grid; gap: 20px;"><label style="${NEUTRAL_LABEL_STYLE}">Name<input name="name" type="text" placeholder="Jane Smith" autocomplete="name" required style="${NEUTRAL_CONTROL_STYLE}"></label><label style="${NEUTRAL_LABEL_STYLE}">Email<input name="email" type="email" placeholder="jane@company.com" autocomplete="email" required style="${NEUTRAL_CONTROL_STYLE}"></label><label style="${NEUTRAL_LABEL_STYLE}">Subject<select name="subject" style="${NEUTRAL_SELECT_STYLE}"><option value="" selected disabled>Select a subject…</option><option value="general">General inquiry</option><option value="project">Start a project</option><option value="support">Support</option></select></label><label style="${NEUTRAL_LABEL_STYLE}">Message<textarea name="message" placeholder="How can we help?" rows="5" required style="${NEUTRAL_CONTROL_STYLE} min-height: 132px; resize: vertical;"></textarea></label><button type="submit" data-label="Form Button" data-incode-component="button" data-kodety-loading-label="Sending…" style="${NEUTRAL_BUTTON_STYLE} width: 100%;">Send message</button><div data-kodety-form-success hidden role="status" style="box-sizing: border-box; width: 100%; padding: 12px 14px; border: 1px solid #a7e8c7; border-radius: 12px; background: #ecfdf5; color: #065f46; font-size: 14px; line-height: 1.45;"><span data-kodety-form-message>Thanks! Your message has been sent.</span></div><div data-kodety-form-error hidden role="alert" style="box-sizing: border-box; width: 100%; padding: 12px 14px; border: 1px solid #fecaca; border-radius: 12px; background: #fef2f2; color: #991b1b; font-size: 14px; line-height: 1.45;"><span data-kodety-form-message>Something went wrong. Please try again.</span></div></form>`,
  'cms-filter': `<form data-label="CMS Filter" data-name="CMS filter" data-incode-component="form" data-kodety-form-mode="filter" data-kodety-capture="false" data-kodety-filter-collection="" data-kodety-filter-map="{}" data-kodety-filter-on="input" data-kodety-filter-url="true" method="get" style="box-sizing: border-box; display: grid; width: 100%; padding: 18px; grid-template-columns: minmax(220px, 2fr) minmax(180px, 1fr) minmax(180px, 1fr) auto; align-items: end; gap: 14px; border: 1px solid #e5e5e5; border-radius: 18px; background: #ffffff; color: #171717; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.05); ${NEUTRAL_FONT_STYLE}"><label style="${NEUTRAL_LABEL_STYLE}">Search<input name="q" type="search" placeholder="Search items…" autocomplete="off" style="${NEUTRAL_CONTROL_STYLE}"></label><label style="${NEUTRAL_LABEL_STYLE}">Category<select name="category" style="${NEUTRAL_SELECT_STYLE}"><option value="" selected>All categories</option><option value="one">Category one</option><option value="two">Category two</option></select></label><label style="${NEUTRAL_LABEL_STYLE}">Maximum value <span data-kodety-range-value style="color: #171717; font-variant-numeric: tabular-nums;">100</span><input name="maximum" type="range" min="0" max="100" step="1" value="100" data-kodety-range-output="[data-kodety-range-value]" style="box-sizing: border-box; width: 100%; min-height: 28px; margin: 0; accent-color: #2b2b2b;"></label><button type="reset" data-label="Reset Filters" data-incode-component="button" style="${NEUTRAL_SECONDARY_BUTTON_STYLE} min-height: 52px;">Reset</button></form>`,
  label: `<label data-label="Label" data-incode-component="label" style="${NEUTRAL_LABEL_STYLE}">Label</label>`,
  input: `<input data-label="Input" data-incode-component="input" type="text" placeholder="Type something…" style="${NEUTRAL_CONTROL_STYLE} max-width: 460px;">`,
  'file-upload': `<label data-label="File Upload" style="position: relative; display: flex; box-sizing: border-box; width: 100%; max-width: 460px; min-height: 112px; padding: 20px; flex-direction: column; align-items: center; justify-content: center; gap: 6px; border: 1px dashed #cfcfcf; border-radius: 16px; background: #f7f7f7; color: #737373; text-align: center; cursor: pointer; ${NEUTRAL_FONT_STYLE}"><strong style="color: #333333; font-size: 14px;">Choose a file</strong><span style="font-size: 12px;">or drag it here · max. 5 MB</span><input data-incode-component="file-upload" type="file" name="file" accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.csv,.rtf,.docx,.xlsx,.odt,.ods" style="position: absolute; inset: 0; display: block; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer;"></label>`,
  textarea: `<textarea data-label="Text Area" data-incode-component="textarea" placeholder="Write your message…" style="${NEUTRAL_CONTROL_STYLE} max-width: 460px; min-height: 132px; resize: vertical;"></textarea>`,
  checkbox: `<label data-label="Checkbox" data-incode-component="checkbox" style="display: inline-flex; box-sizing: border-box; min-height: 44px; padding: 10px 14px; align-items: center; gap: 10px; border: 1px solid #e5e5e5; border-radius: 12px; background: #ffffff; color: #333333; font-size: 14px; cursor: pointer; ${NEUTRAL_FONT_STYLE}"><input type="checkbox" style="width: 18px; height: 18px; margin: 0; accent-color: #2b2b2b;"> Checkbox</label>`,
  radio: `<label data-label="Radio Button" data-incode-component="radio" style="display: inline-flex; box-sizing: border-box; min-height: 44px; padding: 10px 14px; align-items: center; gap: 10px; border: 1px solid #e5e5e5; border-radius: 12px; background: #ffffff; color: #333333; font-size: 14px; cursor: pointer; ${NEUTRAL_FONT_STYLE}"><input type="radio" name="option" style="width: 18px; height: 18px; margin: 0; accent-color: #2b2b2b;"> Radio</label>`,
  select: `<select data-label="Select" data-incode-component="select" style="${NEUTRAL_SELECT_STYLE} max-width: 460px;"><option selected>Select an option…</option><option>Option one</option><option>Option two</option></select>`,
  search: `<form role="search" data-label="Search" data-incode-component="search" style="display: flex; box-sizing: border-box; width: 100%; max-width: 620px; padding: 8px; align-items: center; gap: 8px; border: 1px solid #e5e5e5; border-radius: 18px; background: #ffffff; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.05); ${NEUTRAL_FONT_STYLE}"><input name="q" type="search" placeholder="Search…" autocomplete="off" style="${NEUTRAL_CONTROL_STYLE} min-width: 0; flex: 1; border-color: transparent; background: #f5f5f5;"><button type="submit" data-label="Search Button" data-incode-component="button" style="${NEUTRAL_BUTTON_STYLE} min-width: 104px;">Search</button></form>`,
  'background-video': `<video data-label="Background Video" data-incode-component="background-video" autoplay muted loop playsinline style="${NEUTRAL_MEDIA_STYLE} min-height: 360px;"></video>`,
  dropdown: `<details data-label="Dropdown" data-incode-component="dropdown" style="position: relative; box-sizing: border-box; width: 100%; max-width: 320px; border: 1px solid #e5e5e5; border-radius: 14px; background: #ffffff; color: #333333; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.05); overflow: hidden; ${NEUTRAL_FONT_STYLE}"><summary style="box-sizing: border-box; padding: 14px 16px; font-size: 14px; font-weight: 550; cursor: pointer;">Dropdown</summary><div style="display: grid; padding: 6px; gap: 2px; border-top: 1px solid #eeeeee;"><a href="#" style="padding: 10px 12px; border-radius: 9px; color: #333333; text-decoration: none;">Option 1</a><a href="#" style="padding: 10px 12px; border-radius: 9px; color: #333333; text-decoration: none;">Option 2</a></div></details>`,
  'code-embed': `<iframe data-label="Code Embed" data-incode-component="code-embed" title="Embedded content" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" srcdoc="<body style='margin:0;display:grid;min-height:100vh;place-items:center;background:#171717;color:#a3a3a3;font:14px monospace'>&lt;/&gt; Code embed</body>" style="${NEUTRAL_MEDIA_STYLE} min-height: 360px; background: #171717;"></iframe>`,
  lightbox: buildNativeLightboxMarkup(),
  'locales-list': buildNativeLocaleSelectorMarkup(),
  'overlay-modal': buildNativeModalMarkup(),
  'overlay-drawer': buildNativeDrawerMarkup(),
  'overlay-popover': buildNativePopoverMarkup(),
  'overlay-tooltip': buildNativeTooltipMarkup(),
  'checkout-overlay': buildNativeCheckoutOverlayMarkup(),
  navbar: `<nav data-label="Navbar" data-incode-component="navbar" style="display: flex; box-sizing: border-box; width: 100%; min-height: 72px; padding: 12px 18px; align-items: center; justify-content: space-between; gap: 24px; border: 1px solid #e5e5e5; border-radius: 18px; background: #ffffff; color: #171717; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.05); ${NEUTRAL_FONT_STYLE}"><a href="#" data-nav-brand style="color: #171717; font-size: 17px; font-weight: 650; text-decoration: none;">Brand</a><div data-nav-links style="display: flex; align-items: center; gap: 6px;"><a href="#" style="padding: 10px 12px; color: #171717; text-decoration: none;">Home</a><a href="#" style="padding: 10px 12px; color: #737373; text-decoration: none;">About</a><a href="#" style="${NEUTRAL_BUTTON_STYLE} min-height: 42px; padding: 9px 15px;">Contact</a></div></nav>`,
  slider: `<section data-label="Slider" data-incode-component="slider" data-slider-active="0" style="box-sizing: border-box; width: 100%; border: 1px solid #e5e5e5; border-radius: 20px; background: #ffffff; color: #171717; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06); overflow: hidden; ${NEUTRAL_FONT_STYLE}"><div data-label="Slide" data-slide style="display: grid; min-height: 300px; padding: 40px; place-items: center; background: #f7f7f7; text-align: center;"><div><p style="margin: 0 0 10px; color: #a3a3a3; font-size: 13px; text-transform: uppercase;">Featured</p><h2 style="margin: 0; font-size: 32px;">Slide 1</h2><p style="margin: 12px 0 0; color: #737373;">A clean starting point for your story.</p></div></div><div data-label="Slide" data-slide hidden style="display: grid; min-height: 300px; padding: 40px; place-items: center; background: #f7f7f7; text-align: center;"><div><h2 style="margin: 0; font-size: 32px;">Slide 2</h2><p style="margin: 12px 0 0; color: #737373;">Add the next part of your story.</p></div></div><div data-slider-controls style="display: flex; padding: 12px; align-items: center; justify-content: space-between; gap: 12px;"><button type="button" data-slider-prev style="${NEUTRAL_SECONDARY_BUTTON_STYLE}">Previous</button><span data-slider-status aria-live="polite" style="color: #737373; font-size: 13px;">1 / 2</span><button type="button" data-slider-next style="${NEUTRAL_SECONDARY_BUTTON_STYLE}">Next</button></div></section>`,
  tabs: `<div data-label="Tabs" data-incode-component="tabs" data-tabs-active="0" data-tabs-orientation="horizontal" data-tabs-activation="auto" style="${NEUTRAL_SURFACE_STYLE} padding: 12px;"><div role="tablist" aria-orientation="horizontal" style="display: flex; padding: 4px; gap: 4px; border-radius: 12px; background: #f2f2f2;"><button id="tab-1" type="button" role="tab" aria-selected="true" aria-controls="panel-1" tabindex="0" style="${NEUTRAL_SECONDARY_BUTTON_STYLE} min-height: 40px; flex: 1; padding: 9px 12px;">Tab 1</button><button id="tab-2" type="button" role="tab" aria-selected="false" aria-controls="panel-2" tabindex="-1" style="appearance: none; -webkit-appearance: none; min-height: 40px; flex: 1; padding: 9px 12px; border: 0; border-radius: 10px; background: transparent; color: #737373; font: inherit; cursor: pointer;">Tab 2</button></div><div id="panel-1" role="tabpanel" aria-labelledby="tab-1" style="padding: 24px 12px 12px;"><h3 style="margin: 0; color: #171717;">Tab content</h3><p style="margin: 10px 0 0; color: #737373; line-height: 1.55;">Organize related content without overwhelming the page.</p></div><div id="panel-2" role="tabpanel" aria-labelledby="tab-2" hidden style="padding: 24px 12px 12px;"><p style="margin: 0; color: #737373;">Second tab content.</p></div></div>`,
  map: `<iframe data-label="Map" data-incode-component="map" title="Map" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" srcdoc="<body style='margin:0;display:grid;min-height:100vh;place-items:center;background:#f2f2f2;color:#737373;font:15px system-ui'>Map</body>" style="${NEUTRAL_MEDIA_STYLE} min-height: 360px;"></iframe>`,
  facebook: `<a href="https://facebook.com" data-label="Facebook" data-incode-component="social-link" target="_blank" rel="noopener noreferrer" style="${NEUTRAL_SECONDARY_BUTTON_STYLE}">Facebook</a>`,
  twitter: `<a href="https://x.com" data-label="X (Twitter)" data-incode-component="social-link" target="_blank" rel="noopener noreferrer" style="${NEUTRAL_SECONDARY_BUTTON_STYLE}">X (Twitter)</a>`,
  'custom-element': `<div data-label="Custom Element" data-incode-component="custom-element" style="display: grid; box-sizing: border-box; width: 100%; min-height: 180px; padding: 24px; place-items: center; border: 1px dashed #d4d4d4; border-radius: 18px; background: #f7f7f7; color: #737373; ${NEUTRAL_FONT_STYLE}">Custom Element</div>`,
  'code-block': `<pre data-label="Code Block" data-incode-component="code-block" style="box-sizing: border-box; width: 100%; margin: 0; padding: 22px; border: 1px solid #2f2f2f; border-radius: 16px; background: #171717; color: #d4d4d4; font: 14px/1.65 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; overflow: auto;"><code class="language-javascript">const message = "Hello, Kodety";</code></pre>`,
  hr: '<hr data-label="Divider" style="box-sizing: border-box; width: 100%; margin: 24px 0; border: 0; border-top: 1px solid #e5e5e5;">',
  rectangle:
    '<svg data-label="Rectangle" viewBox="0 0 200 120" role="img" aria-label="Rectangle" style="display: block; width: 200px; height: 120px; color: #d4d4d4;"><rect width="200" height="120" rx="16" fill="currentColor"></rect></svg>',
  oval: '<svg data-label="Oval" viewBox="0 0 200 120" role="img" aria-label="Oval" style="display: block; width: 200px; height: 120px; color: #d4d4d4;"><ellipse cx="100" cy="60" rx="100" ry="60" fill="currentColor"></ellipse></svg>',
  polygon:
    '<svg data-label="Polygon" viewBox="0 0 120 120" role="img" aria-label="Polygon" style="display: block; width: 120px; height: 120px; color: #d4d4d4;"><polygon points="60,4 113,34 113,86 60,116 7,86 7,34" fill="currentColor"></polygon></svg>',
  star: '<svg data-label="Star" viewBox="0 0 120 120" role="img" aria-label="Star" style="display: block; width: 120px; height: 120px; color: #d4d4d4;"><path d="M60 4l16.5 33.4 36.9 5.4-26.7 26 6.3 36.8L60 88.2l-33 17.4 6.3-36.8-26.7-26 36.9-5.4z" fill="currentColor"></path></svg>',
  path: '<svg data-label="Path" viewBox="0 0 200 120" role="img" aria-label="Path" style="display: block; width: 200px; height: 120px; color: #a3a3a3;"><path d="M10 100 C45 10 155 10 190 100" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"></path></svg>',
};

export const NATIVE_OVERLAY_BUILDERS: Record<string, (model: { id: string }) => string> = {
  'overlay-modal': buildNativeModalMarkup,
  'overlay-drawer': buildNativeDrawerMarkup,
  'overlay-popover': buildNativePopoverMarkup,
  'overlay-tooltip': buildNativeTooltipMarkup,
  'checkout-overlay': buildNativeCheckoutOverlayMarkup,
};

export const CONTAINER_TAGS = new Set([
  'body',
  'main',
  'section',
  'div',
  'article',
  'aside',
  'nav',
  'header',
  'footer',
  'form',
  'ul',
  'ol',
  'li',
  'picture',
  'select',
  'details',
  'summary',
  'blockquote',
  'pre',
  'button',
  'a',
  'label',
]);

export const CSS_SHORTHAND_GROUPS: Record<string, string[]> = {
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  background: [
    'background-color',
    'background-image',
    'background-position',
    'background-size',
    'background-repeat',
    'background-attachment',
    'background-clip',
    'background-origin',
  ],
  border: [
    'border-width',
    'border-style',
    'border-color',
    'border-top',
    'border-right',
    'border-bottom',
    'border-left',
  ],
  'border-radius': [
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-right-radius',
    'border-bottom-left-radius',
  ],
  outline: ['outline-width', 'outline-style', 'outline-color'],
  font: ['font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch', 'font-variant', 'line-height'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  'flex-flow': ['flex-direction', 'flex-wrap'],
  grid: [
    'grid-template',
    'grid-template-rows',
    'grid-template-columns',
    'grid-auto-flow',
    'grid-auto-rows',
    'grid-auto-columns',
  ],
  overflow: ['overflow-x', 'overflow-y'],
  inset: ['top', 'right', 'bottom', 'left'],
  transition: ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay'],
  animation: [
    'animation-name',
    'animation-duration',
    'animation-timing-function',
    'animation-delay',
    'animation-iteration-count',
    'animation-direction',
    'animation-fill-mode',
    'animation-play-state',
  ],
  'text-decoration': [
    'text-decoration-line',
    'text-decoration-color',
    'text-decoration-style',
    'text-decoration-thickness',
  ],
};

export const INLINE_TEXT_EDIT_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'em',
  'i', 'ins', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong',
  'sub', 'sup', 'time', 'u', 'var', 'wbr',
]);

export const INLINE_TEXT_EDIT_DROP_CONTENT_TAGS = new Set([
  'script', 'style', 'template', 'iframe', 'object', 'embed', 'svg', 'math',
]);

export const INLINE_TEXT_EDIT_GLOBAL_ATTRIBUTES = new Set([
  'class', 'id', 'style', 'title', 'lang', 'dir', 'role', 'tabindex',
]);

export const CANVAS_MOTION_AUTHORITY_PROPERTIES = new Set([
  'opacity',
  'visibility',
  'transform',
  'translate',
  'rotate',
  'scale',
  'filter',
  'clip-path',
  'content-visibility',
]);

export const CANVAS_VISIBILITY_ATTRIBUTE_NAMES = new Set(['hidden', 'aria-hidden', 'data-kodety-hidden-display']);
