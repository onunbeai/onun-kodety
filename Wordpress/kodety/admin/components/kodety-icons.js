import archiveIcon from '@solar-icons/raw/bold-duotone/archive.svg';
import audioIcon from '@solar-icons/raw/bold-duotone/music-note.svg';
import videoIcon from '@solar-icons/raw/bold-duotone/video-frame-play-horizontal.svg';
import layersIcon from '@solar-icons/raw/bold-duotone/layers.svg';
import arrowDownIcon from '@solar-icons/raw/linear/arrow-down.svg';
import arrowLeftIcon from '@solar-icons/raw/linear/arrow-left.svg';
import arrowRightIcon from '@solar-icons/raw/linear/arrow-right.svg';
import arrowUpIcon from '@solar-icons/raw/linear/arrow-up.svg';
import arrowUpDownIcon from '@solar-icons/raw/linear/sort-vertical.svg';
import paletteIcon from '@solar-icons/raw/bold-duotone/palette-round.svg';
import analyticsIcon from '@solar-icons/raw/bold-duotone/chart-2.svg';
import bellIcon from '@solar-icons/raw/bold-duotone/bell.svg';
import blocksIcon from '@solar-icons/raw/bold-duotone/widget-4.svg';
import bookIcon from '@solar-icons/raw/bold-duotone/book.svg';
import calendarIcon from '@solar-icons/raw/bold-duotone/calendar.svg';
import checkIcon from '@solar-icons/raw/bold-duotone/check-read.svg';
import chevronDownIcon from '@solar-icons/raw/linear/alt-arrow-down.svg';
import chevronLeftIcon from '@solar-icons/raw/linear/alt-arrow-left.svg';
import chevronRightIcon from '@solar-icons/raw/linear/alt-arrow-right.svg';
import chevronUpIcon from '@solar-icons/raw/linear/alt-arrow-up.svg';
import chevronsLeftIcon from '@solar-icons/raw/linear/double-alt-arrow-left.svg';
import chevronsRightIcon from '@solar-icons/raw/linear/double-alt-arrow-right.svg';
import warningIcon from '@solar-icons/raw/bold-duotone/danger-circle.svg';
import successIcon from '@solar-icons/raw/bold-duotone/check-circle.svg';
import helpIcon from '@solar-icons/raw/bold-duotone/question-circle.svg';
import userIcon from '@solar-icons/raw/bold-duotone/user.svg';
import copyIcon from '@solar-icons/raw/bold-duotone/copy.svg';
import codeIcon from '@solar-icons/raw/bold-duotone/code-square.svg';
import databaseIcon from '@solar-icons/raw/bold-duotone/database.svg';
import downloadIcon from '@solar-icons/raw/linear/download.svg';
import moreIcon from '@solar-icons/raw/linear/menu-dots.svg';
import externalIcon from '@solar-icons/raw/linear/square-arrow-right-up.svg';
import eyeIcon from '@solar-icons/raw/bold-duotone/eye.svg';
import fileIcon from '@solar-icons/raw/bold-duotone/document-text.svg';
import filesIcon from '@solar-icons/raw/bold-duotone/documents.svg';
import folderIcon from '@solar-icons/raw/bold-duotone/folder.svg';
import websiteIcon from '@solar-icons/raw/bold-duotone/global.svg';
import homeIcon from '@solar-icons/raw/bold-duotone/home-2.svg';
import imageIcon from '@solar-icons/raw/bold-duotone/gallery.svg';
import imagePlusIcon from '@solar-icons/raw/bold-duotone/gallery-add.svg';
import infoIcon from '@solar-icons/raw/bold-duotone/info-circle.svg';
import dashboardIcon from '@solar-icons/raw/bold-duotone/widget-2.svg';
import editorIcon from '@solar-icons/raw/bold-duotone/window-frame.svg';
import gridIcon from '@solar-icons/raw/bold-duotone/widget.svg';
import linkIcon from '@solar-icons/raw/bold-duotone/link.svg';
import listIcon from '@solar-icons/raw/bold-duotone/list.svg';
import filterIcon from '@solar-icons/raw/bold-duotone/filter.svg';
import lockIcon from '@solar-icons/raw/bold-duotone/lock.svg';
import logoutIcon from '@solar-icons/raw/linear/logout.svg';
import mailIcon from '@solar-icons/raw/bold-duotone/letter.svg';
import marketingIcon from '@solar-icons/raw/bold-duotone/volume-loud.svg';
import menuIcon from '@solar-icons/raw/linear/hamburger-menu.svg';
import commentsIcon from '@solar-icons/raw/bold-duotone/chat-round-dots.svg';
import monitorIcon from '@solar-icons/raw/bold-duotone/monitor.svg';
import packageIcon from '@solar-icons/raw/bold-duotone/box.svg';
import panelCloseIcon from '@solar-icons/raw/linear/sidebar.svg';
import panelOpenIcon from '@solar-icons/raw/linear/sidebar-minimalistic.svg';
import pencilIcon from '@solar-icons/raw/bold-duotone/pen.svg';
import pluginsIcon from '@solar-icons/raw/bold-duotone/plug-circle.svg';
import plusIcon from '@solar-icons/raw/linear/add.svg';
import refreshIcon from '@solar-icons/raw/linear/refresh.svg';
import saveIcon from '@solar-icons/raw/bold-duotone/diskette.svg';
import searchIcon from '@solar-icons/raw/bold-duotone/magnifier.svg';
import sendIcon from '@solar-icons/raw/bold-duotone/send-square.svg';
import settingsIcon from '@solar-icons/raw/bold-duotone/settings.svg';
import shieldIcon from '@solar-icons/raw/bold-duotone/shield-check.svg';
import slidersIcon from '@solar-icons/raw/bold-duotone/tuning-2.svg';
import smartphoneIcon from '@solar-icons/raw/bold-duotone/smartphone.svg';
import sparklesIcon from '@solar-icons/raw/bold-duotone/stars.svg';
import tagIcon from '@solar-icons/raw/bold-duotone/tag.svg';
import toolsIcon from '@solar-icons/raw/bold-duotone/sledgehammer.svg';
import trashIcon from '@solar-icons/raw/bold-duotone/trash-bin-trash.svg';
import unlinkIcon from '@solar-icons/raw/bold-duotone/unlink.svg';
import uploadIcon from '@solar-icons/raw/linear/upload.svg';
import usersIcon from '@solar-icons/raw/bold-duotone/users-group-rounded.svg';
import xIcon from '@solar-icons/raw/linear/close.svg';

const kodetyBrandIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 114 122">
  <path fill="currentColor" d="M51.1932 122L0 61L113.183 94.8289V122H51.1932Z"/>
  <path fill="currentColor" d="M51.1932 0L0 61L113.183 27.1711V0H51.1932Z"/>
</svg>`;

/**
 * Curated Solar registry: Duotone resources, Linear navigation controls for the WordPress admin surface.
 *
 * The public names are deliberately semantic. WordPress adapters should not
 * need to know the package asset names, which keeps future icon changes
 * confined to this registry.
 */
const registry = Object.freeze({
  archive: archiveIcon,
  audio: audioIcon,
  video: videoIcon,
  layers: layersIcon,
  'arrow-down': arrowDownIcon,
  'arrow-left': arrowLeftIcon,
  'arrow-right': arrowRightIcon,
  'arrow-up': arrowUpIcon,
  'arrow-up-down': arrowUpDownIcon,
  appearance: paletteIcon,
  analytics: analyticsIcon,
  bell: bellIcon,
  blocks: blocksIcon,
  book: bookIcon,
  calendar: calendarIcon,
  check: checkIcon,
  'chevron-down': chevronDownIcon,
  'chevron-left': chevronLeftIcon,
  'chevron-right': chevronRightIcon,
  'chevron-up': chevronUpIcon,
  'chevrons-left': chevronsLeftIcon,
  'chevrons-right': chevronsRightIcon,
  comments: commentsIcon,
  code: codeIcon,
  copy: copyIcon,
  dashboard: dashboardIcon,
  database: databaseIcon,
  download: downloadIcon,
  editor: editorIcon,
  external: externalIcon,
  'external-link': externalIcon,
  eye: eyeIcon,
  file: fileIcon,
  files: filesIcon,
  filter: filterIcon,
  folder: folderIcon,
  grid: gridIcon,
  help: helpIcon,
  home: homeIcon,
  image: imageIcon,
  'image-plus': imagePlusIcon,
  info: infoIcon,
  kodety: kodetyBrandIcon,
  link: linkIcon,
  list: listIcon,
  lock: lockIcon,
  logout: logoutIcon,
  mail: mailIcon,
  marketing: marketingIcon,
  media: imageIcon,
  menu: menuIcon,
  more: moreIcon,
  'more-horizontal': moreIcon,
  package: packageIcon,
  pages: filesIcon,
  'panel-close': panelCloseIcon,
  'panel-open': panelOpenIcon,
  pencil: pencilIcon,
  plugins: pluginsIcon,
  plus: plusIcon,
  posts: fileIcon,
  refresh: refreshIcon,
  save: saveIcon,
  search: searchIcon,
  send: sendIcon,
  settings: settingsIcon,
  shield: shieldIcon,
  sliders: slidersIcon,
  smartphone: smartphoneIcon,
  sparkles: sparklesIcon,
  success: successIcon,
  tablet: smartphoneIcon,
  tag: tagIcon,
  theme: paletteIcon,
  tools: toolsIcon,
  trash: trashIcon,
  unlink: unlinkIcon,
  upload: uploadIcon,
  user: userIcon,
  'user-circle': userIcon,
  users: usersIcon,
  view: eyeIcon,
  warning: warningIcon,
  website: websiteIcon,
  monitor: monitorIcon,
  x: xIcon,
});

const aliases = Object.freeze({
  add: 'plus',
  close: 'x',
  collapse: 'panel-close',
  expand: 'panel-open',
  globe: 'website',
  page: 'pages',
  post: 'posts',
  remove: 'trash',
  sort: 'arrow-up-down',
  update: 'refresh',
});

const iconNames = Object.freeze(Object.keys(registry).sort());
const namespace = 'http://www.w3.org/2000/svg';

const normalizeName = (name) => {
  const normalized = String(name || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();

  return aliases[normalized] || normalized;
};

const cleanClassNames = (...values) =>
  values
    .flatMap((value) => String(value || '').split(/\s+/))
    .filter((value) => /^[a-zA-Z0-9_-]+$/.test(value))
    .filter((value, index, list) => list.indexOf(value) === index)
    .join(' ');

const readNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const resolveTarget = (target) => {
  if (typeof target === 'string') return document.querySelector(target);
  return target && target.nodeType === 1 ? target : null;
};

const createTitle = (text) => {
  const title = document.createElementNS(namespace, 'title');
  title.textContent = text;
  return title;
};

const createSvgFromMarkup = (markup) => {
  const template = document.createElement('template');
  template.innerHTML = String(markup || '').trim();
  const svg = template.content.firstElementChild;
  return svg?.namespaceURI === namespace ? svg.cloneNode(true) : null;
};

const create = (name, options = {}) => {
  const normalizedName = normalizeName(name);
  const iconMarkup = registry[normalizedName];
  if (!iconMarkup) return null;

  const numericSize = Number(options.size);
  const size = options.size ?? '1em';
  let strokeWidth = readNumber(options.strokeWidth, 1.8, 0.5, 4);

  if (options.absoluteStrokeWidth && Number.isFinite(numericSize) && numericSize > 0) {
    strokeWidth = (24 * strokeWidth) / numericSize;
  }

  const className = cleanClassNames(
    'kodety-icon',
    `kodety-icon--${normalizedName}`,
    options.className,
  );
  const label = String(options.label || options.title || '').trim();
  const attributes = {
    class: className,
    width: size,
    height: size,
    color: options.color || 'currentColor',
    'stroke-width': strokeWidth,
    focusable: 'false',
    'data-kodety-icon-name': normalizedName,
  };

  if (label) {
    attributes['aria-label'] = label;
    attributes.role = 'img';
  } else {
    attributes['aria-hidden'] = 'true';
  }

  const svg = createSvgFromMarkup(iconMarkup);
  if (!svg) return null;
  Object.entries(attributes).forEach(([key, value]) => {
    svg.setAttribute(key, String(value));
  });

  if (label) svg.insertBefore(createTitle(label), svg.firstChild);

  return svg;
};

const optionsFromDataset = (target) => ({
  size: target.dataset.kodetyIconSize || undefined,
  strokeWidth: target.dataset.kodetyIconStroke || undefined,
  color: target.dataset.kodetyIconColor || undefined,
  className: target.dataset.kodetyIconClass || undefined,
  label: target.dataset.kodetyIconLabel || undefined,
  absoluteStrokeWidth: target.dataset.kodetyIconAbsoluteStroke === 'true',
});

const signatureFor = (name, options) =>
  JSON.stringify([
    normalizeName(name),
    options.size || '',
    options.strokeWidth || '',
    options.color || '',
    options.className || '',
    options.label || options.title || '',
    Boolean(options.absoluteStrokeWidth),
  ]);

const mount = (target, name, options = {}) => {
  const element = resolveTarget(target);
  if (!element) return null;

  const iconName = name || element.dataset.kodetyIcon;
  const svg = create(iconName, options);
  if (!svg) {
    element.dataset.kodetyIconError = `unknown:${normalizeName(iconName)}`;
    return null;
  }

  element.replaceChildren(svg);
  element.dataset.kodetyIconReady = signatureFor(iconName, options);
  delete element.dataset.kodetyIconError;
  return svg;
};

const scan = (root = document) => {
  if (!root || typeof root.querySelectorAll !== 'function') return [];

  const targets = [];
  if (root.nodeType === 1 && root.matches('[data-kodety-icon]')) targets.push(root);
  root.querySelectorAll('[data-kodety-icon]').forEach((target) => targets.push(target));

  return targets
    .map((target) => {
      const options = optionsFromDataset(target);
      const signature = signatureFor(target.dataset.kodetyIcon, options);
      if (target.dataset.kodetyIconReady === signature) {
        return target.querySelector(':scope > svg[data-kodety-icon-name]');
      }
      return mount(target, target.dataset.kodetyIcon, options);
    })
    .filter(Boolean);
};

let observer = null;

const observe = (root = document.body) => {
  if (!root || typeof MutationObserver === 'undefined') return null;
  if (observer) observer.disconnect();

  observer = new MutationObserver((records) => {
    records.forEach((record) => {
      if (record.type === 'attributes') {
        scan(record.target);
        return;
      }
      record.addedNodes.forEach((node) => {
        if (node.nodeType === 1) scan(node);
      });
    });
  });

  observer.observe(root, {
    attributes: true,
    attributeFilter: [
      'data-kodety-icon',
      'data-kodety-icon-size',
      'data-kodety-icon-stroke',
      'data-kodety-icon-color',
      'data-kodety-icon-class',
      'data-kodety-icon-label',
      'data-kodety-icon-absolute-stroke',
    ],
    childList: true,
    subtree: true,
  });

  return observer;
};

const disconnect = () => {
  if (!observer) return;
  observer.disconnect();
  observer = null;
};

const api = Object.freeze({
  version: '3.1.0',
  library: '@solar-icons/react@2.1.0',
  styles: Object.freeze(['bold-duotone', 'linear']),
  names: iconNames,
  has: (name) => Boolean(registry[normalizeName(name)]),
  create,
  mount,
  scan,
  observe,
  disconnect,
});

window.KodetyIcons = api;

const boot = () => {
  scan(document);
  observe(document.body);
  document.dispatchEvent(
    new CustomEvent('kodety:icons-ready', {
      detail: { api },
    }),
  );
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
