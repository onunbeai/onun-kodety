import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import JSZip from 'jszip';
import { parse, parseFragment, serialize } from 'parse5';

const input = path.resolve(process.argv[2] || '');
const output = path.resolve(process.argv[3] || 'extensions/kodefy/themes/noise');
const archiveOutput = path.resolve(process.argv[4] || 'extensions/kodefy/dist/noise-kodefy-commerce.zip');
const epoch = new Date('2000-01-01T00:00:00.000Z');

if (!input || !input.toLowerCase().endsWith('.zip')) {
  throw new Error('Uso: node scripts/convert-webflow-kodefy-theme.mjs <webflow.zip> [diretorio] [tema.zip]');
}

const attribute = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const hasAttribute = (node, name) => node.attrs?.some((item) => item.name === name) || false;
const setAttribute = (node, name, value = '') => {
  if (!node.attrs) node.attrs = [];
  const existing = node.attrs.find((item) => item.name === name);
  if (existing) existing.value = String(value);
  else node.attrs.push({ name, value: String(value) });
};
const removeAttribute = (node, name) => {
  if (node.attrs) node.attrs = node.attrs.filter((item) => item.name !== name);
};
const classes = (node) => new Set((attribute(node, 'class') || '').split(/\s+/).filter(Boolean));
const hasClass = (node, name) => classes(node).has(name);
const classIncludes = (node, value) => [...classes(node)].some((name) => name.includes(value));
const isElement = (node, tag) => Boolean(node?.tagName) && (!tag || node.tagName === tag);
const children = (node) => Array.isArray(node?.childNodes) ? node.childNodes : [];
const walk = (node, callback) => {
  callback(node);
  for (const child of [...children(node)]) walk(child, callback);
};
const findAll = (node, predicate) => {
  const matches = [];
  walk(node, (candidate) => { if (predicate(candidate)) matches.push(candidate); });
  return matches;
};
const findFirst = (node, predicate) => findAll(node, predicate)[0] || null;
const closest = (node, predicate) => {
  let current = node?.parentNode || null;
  while (current) {
    if (predicate(current)) return current;
    current = current.parentNode || null;
  }
  return null;
};
const removeNode = (node) => {
  const parent = node?.parentNode;
  if (!parent?.childNodes) return;
  parent.childNodes = parent.childNodes.filter((candidate) => candidate !== node);
};
const setTag = (node, tag) => {
  if (!isElement(node)) return;
  node.nodeName = tag;
  node.tagName = tag;
};
const setText = (node, text) => {
  node.childNodes = [{ nodeName: '#text', value: text, parentNode: node }];
};
const appendHtml = (node, html, prepend = false) => {
  const fragment = parseFragment(html);
  const next = fragment.childNodes || [];
  for (const child of next) child.parentNode = node;
  node.childNodes = prepend ? [...next, ...children(node)] : [...children(node), ...next];
};
const descendant = (node, predicate) => findFirst(node, predicate);
const textContent = (node) => {
  let value = '';
  walk(node, (candidate) => { if (candidate.nodeName === '#text') value += candidate.value || ''; });
  return value;
};
const slug = (value, fallback) => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 64) || fallback;

function safeZipPath(value) {
  const normalized = value.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0') || normalized.split('/').includes('..')) return '';
  return normalized;
}

function relativePrefix(file) {
  const depth = file.split('/').length - 1;
  return '../'.repeat(depth);
}

function labelSections(document, file) {
  const base = slug(file.replace(/\.html?$/i, ''), 'page');
  let index = 0;
  for (const node of findAll(document, (candidate) => isElement(candidate) && ['header', 'main', 'section', 'footer'].includes(candidate.tagName))) {
    index += 1;
    const className = (attribute(node, 'class') || '').split(/\s+/).find(Boolean) || node.tagName;
    if (!hasAttribute(node, 'data-label')) {
      setAttribute(node, 'data-label', className.replaceAll('-', ' ').replaceAll('_', ' '));
    }
    if (node.tagName === 'section' && !hasAttribute(node, 'data-kodety-section-id')) {
      setAttribute(node, 'data-kodety-section-id', `${base}-${slug(className, `section-${index}`)}`);
    }
  }
}

function removeSmootifyAssets(document) {
  for (const node of findAll(document, (candidate) => isElement(candidate, 'script') || isElement(candidate, 'link'))) {
    const url = attribute(node, node.tagName === 'script' ? 'src' : 'href') || '';
    if (/smootify\.io/i.test(url) || /SmootifyUserOptions/.test(textContent(node))) removeNode(node);
  }
  for (const node of findAll(document, (candidate) => isElement(candidate) && hasClass(candidate, 'pop-up'))) removeNode(node);
}

function addThemeAssets(document, file) {
  const prefix = relativePrefix(file);
  const head = findFirst(document, (node) => isElement(node, 'head'));
  const body = findFirst(document, (node) => isElement(node, 'body'));
  if (head) {
    appendHtml(head, `<meta name="kodefy-theme" content="noise-webflow"><link href="${prefix}css/kodefy-theme.css" rel="stylesheet" type="text/css">`);
  }
  if (body) appendHtml(body, `<script src="${prefix}js/kodefy-theme.js" type="text/javascript"></script>`);
}

function transformLinksAndSearch(document, file) {
  const prefix = relativePrefix(file);
  for (const link of findAll(document, (node) => isElement(node, 'a'))) {
    const href = attribute(link, 'href') || '';
    if (/(^|\/)account(?:\/|\.html|$)/i.test(href)) {
      setAttribute(link, 'data-kodefy-account-link');
      setAttribute(link, 'href', '#');
      removeAttribute(link, 'aria-current');
    }
    if (/(^|\/)cart\.html(?:$|[?#])/i.test(href)) setAttribute(link, 'data-kodefy-cart-link');
    if (/(^|\/)wishlist\.html(?:$|[?#])/i.test(href)) setAttribute(link, 'data-kodefy-wishlist-link');
    if (/(^|\/)shop\.html(?:$|[?#])/i.test(href)) setAttribute(link, 'data-kodefy-shop-link');
  }

  for (const form of findAll(document, (node) => isElement(node, 'form'))) {
    const search = descendant(form, (node) => isElement(node, 'input') && attribute(node, 'type') === 'search');
    if (!search) continue;
    setAttribute(form, 'data-kodefy-search-form');
    setAttribute(form, 'action', `${prefix}search.html`);
    setAttribute(search, 'name', 'q');
  }

  for (const node of findAll(document, (candidate) => isElement(candidate))) {
    if (attribute(node, 'cart') === 'count') setAttribute(node, 'data-kodefy-cart-count');
    if (hasClass(node, 'mini-cart_button')) {
      setAttribute(node, 'data-kodefy-cart-open');
      setAttribute(node, 'role', 'button');
      setAttribute(node, 'tabindex', '0');
    }
    if (hasClass(node, 'mini-cart_dropdown-list') || hasClass(node, 'smootify-search_result-list')) setAttribute(node, 'hidden');
    if (node.tagName === 'passwordless-login') setAttribute(node, 'hidden');
    if (node.tagName === 'smootify-search') setTag(node, 'div');
  }
}

function bindProductFields(root) {
  for (const node of findAll(root, (candidate) => isElement(candidate))) {
    const product = attribute(node, 'product');
    const variation = attribute(node, 'variation');
    const prop = attribute(node, 'data-prop');
    if (product === 'title') setAttribute(node, 'data-kodefy-product-title');
    if (product === 'vendor' || product === 'collection') setAttribute(node, 'data-kodefy-product-vendor');
    if (product === 'url' && node.tagName === 'a') setAttribute(node, 'data-kodefy-product-link');
    if (product === 'specific-image' || variation === 'image') setAttribute(node, 'data-kodefy-product-image');
    if (prop === 'price') setAttribute(node, 'data-kodefy-product-price');
    if (prop === 'compareAtPrice') {
      setAttribute(node, 'data-kodefy-product-compare-price');
      setAttribute(node, 'hidden');
    }
  }

  for (const title of findAll(root, (node) => isElement(node) && hasAttribute(node, 'data-kodefy-product-title'))) {
    const link = closest(title, (node) => isElement(node, 'a'));
    if (link) setAttribute(link, 'data-kodefy-product-link');
  }

  const image = findFirst(root, (node) => isElement(node, 'img') && hasAttribute(node, 'data-kodefy-product-image'))
    || findFirst(root, (node) => isElement(node, 'img'));
  if (image) setAttribute(image, 'data-kodefy-product-image');

  const addWrapper = findFirst(root, (node) => isElement(node) && node.tagName === 'smootify-add-to-cart');
  const add = addWrapper && (
    findFirst(addWrapper, (node) => isElement(node, 'button') && attribute(node, 'type') === 'submit')
    || findFirst(addWrapper, (node) => isElement(node, 'button') && attribute(node, 'type') !== 'reset' && !hasAttribute(node, 'option'))
  );
  if (add) {
    setAttribute(add, 'data-kodefy-add');
    setAttribute(add, 'type', 'button');
  }

  for (const wish of findAll(root, (node) => isElement(node) && node.tagName === 'wishlist-toggle')) {
    setTag(wish, 'button');
    setAttribute(wish, 'type', 'button');
    setAttribute(wish, 'data-kodefy-wishlist-toggle');
    setAttribute(wish, 'aria-label', 'Adicionar aos favoritos');
  }
}

function ensureWishlistButton(root) {
  if (descendant(root, (node) => isElement(node) && hasAttribute(node, 'data-kodefy-wishlist-toggle'))) return;
  const target = findFirst(root, (node) => isElement(node) && hasClass(node, 'product4_content-bottom')) || root;
  appendHtml(target, '<button class="kodefy-wishlist-button" type="button" data-kodefy-wishlist-toggle aria-label="Adicionar aos favoritos" aria-pressed="false"><span aria-hidden="true">♡</span></button>', true);
}

function listingContainer(product) {
  return closest(product, (node) => isElement(node) && (
    hasClass(node, 'w-dyn-items')
    || classIncludes(node, 'grid')
    || classIncludes(node, 'list')
    || classIncludes(node, 'products-container')
  )) || product.parentNode;
}

function transformProductListings(document, file, detailRoot) {
  const inMain = (node) => Boolean(closest(node, (candidate) => isElement(candidate, 'main') || hasClass(candidate, 'main-wrapper')));
  const products = findAll(document, (node) => isElement(node) && node.tagName === 'smootify-product');
  for (const product of products) {
    if (product === detailRoot) continue;
    const hasTitle = descendant(product, (node) => isElement(node) && attribute(node, 'product') === 'title');
    const hasImage = descendant(product, (node) => isElement(node, 'img'));
    if (!hasTitle || !hasImage) continue;
    bindProductFields(product);
    setTag(product, 'article');
    setAttribute(product, 'data-kodefy-product-card');
    setAttribute(product, 'data-kodefy-template');
    setAttribute(product, 'data-label', 'Shopify Product Card');
    ensureWishlistButton(product);
    const container = listingContainer(product);
    if (!isElement(container)) continue;
    const limit = Math.max(1, Math.min(24, Number(attribute(product, 'limit')) || (inMain(product) ? 8 : 1)));
    setAttribute(container, 'data-kodefy-products');
    setAttribute(container, 'data-limit', limit);
    setAttribute(container, 'data-empty-message', 'Nenhum produto Shopify disponível.');
  }

  if (file === 'wishlist.html') {
    const root = findFirst(document, (node) => isElement(node) && hasAttribute(node, 'data-kodefy-products') && inMain(node));
    if (root) {
      removeAttribute(root, 'data-kodefy-products');
      setAttribute(root, 'data-kodefy-wishlist-products');
      setAttribute(root, 'data-empty-message', 'Sua lista de favoritos está vazia.');
    }
  }

  if (file === 'last-viewed.html') {
    const root = findFirst(document, (node) => isElement(node) && hasAttribute(node, 'data-kodefy-products') && inMain(node));
    if (root) {
      setAttribute(root, 'data-limit', '3');
      setAttribute(root, 'data-sort', 'UPDATED_AT');
    }
  }
}

function transformProductDetail(document, file) {
  if (file !== 'detail_product.html') return null;
  const detail = findFirst(document, (node) => isElement(node) && node.tagName === 'smootify-product'
    && descendant(node, (candidate) => isElement(candidate) && hasClass(candidate, 'product_grid')));
  if (!detail) return null;
  bindProductFields(detail);
  setTag(detail, 'div');
  setAttribute(detail, 'data-kodefy-product-detail');
  setAttribute(detail, 'data-label', 'Shopify Product Detail');

  const title = findFirst(detail, (node) => isElement(node) && attribute(node, 'product') === 'title');
  const vendor = findFirst(detail, (node) => isElement(node) && ['vendor', 'collection'].includes(attribute(node, 'product')));
  const description = findFirst(detail, (node) => isElement(node) && hasClass(node, 'w-richtext'));
  const select = findFirst(detail, (node) => isElement(node, 'select'));
  const quantity = findFirst(detail, (node) => isElement(node, 'input') && attribute(node, 'type') === 'number');
  const inventory = findFirst(detail, (node) => isElement(node) && hasClass(node, 'add-to-cart_stock-wrapper'));
  if (title) setAttribute(title, 'data-kodefy-product-title');
  if (vendor) setAttribute(vendor, 'data-kodefy-product-vendor');
  if (description) setAttribute(description, 'data-kodefy-product-description');
  if (select) setAttribute(select, 'data-kodefy-variant');
  if (quantity) {
    setAttribute(quantity, 'data-kodefy-product-quantity');
    setAttribute(quantity, 'value', '1');
    setAttribute(quantity, 'min', '1');
    setAttribute(quantity, 'max', '99');
  }
  if (inventory) {
    setAttribute(inventory, 'data-kodefy-inventory');
    setText(inventory, 'Verificando estoque…');
  }
  for (const control of findAll(detail, (node) => isElement(node))) {
    if (control.tagName === 'variant-swatches' || control.tagName === 'dynamic-property' || control.tagName === 'store-availability') {
      setAttribute(control, 'hidden');
    }
    const action = attribute(control, 'data-action');
    if ((action === 'minus' || action === 'plus') && closest(control, (node) => node === detail)) {
      setAttribute(control, 'data-kodefy-product-quantity-step');
      setAttribute(control, 'data-delta', action === 'minus' ? '-1' : '1');
      setAttribute(control, 'type', 'button');
    }
  }

  const thumbs = findFirst(detail, (node) => isElement(node) && hasClass(node, 'product_thumbnails-container'));
  const slide = findFirst(detail, (node) => isElement(node) && hasClass(node, 'product-slider_slide'));
  if (thumbs) setAttribute(thumbs, 'data-kodefy-gallery-thumbs');
  if (slide) {
    appendHtml(slide, '<img src="images/6191a88a1c0e39463c2bf022_placeholder-image.svg" alt="Produto Shopify" class="kodefy-product-main-image" data-kodefy-gallery-main>', true);
  } else {
    const image = findFirst(detail, (node) => isElement(node, 'img'));
    if (image) setAttribute(image, 'data-kodefy-gallery-main');
  }

  const addWrapper = findFirst(detail, (node) => isElement(node) && node.tagName === 'smootify-add-to-cart');
  if (addWrapper) {
    const primary = findFirst(addWrapper, (node) => isElement(node, 'button') && hasAttribute(node, 'data-kodefy-add'))
      || findFirst(addWrapper, (node) => isElement(node, 'button') && attribute(node, 'type') === 'submit');
    if (primary) {
      setAttribute(primary, 'data-kodefy-add');
      setAttribute(primary, 'data-label', 'Adicionar ao carrinho');
      setAttribute(primary, 'type', 'button');
    }
    for (const extra of findAll(addWrapper, (node) => isElement(node, 'button') && attribute(node, 'type') === 'submit')) setAttribute(extra, 'hidden');
    if (!descendant(detail, (node) => isElement(node) && hasAttribute(node, 'data-kodefy-wishlist-toggle'))) {
      const actions = findFirst(addWrapper, (node) => isElement(node) && hasClass(node, 'add-to-cart_buttons-wrapper')) || addWrapper;
      appendHtml(actions, '<button class="button is-alternate kodefy-wishlist-button" type="button" data-kodefy-wishlist-toggle data-kodefy-wishlist-label aria-pressed="false">Adicionar aos favoritos</button>');
    }
  }
  return detail;
}

function transformCollection(document, file) {
  if (file !== 'detail_collection.html') return;
  const main = findFirst(document, (node) => isElement(node, 'main'))
    || findFirst(document, (node) => isElement(node) && hasClass(node, 'main-wrapper'));
  if (!main) return;
  setAttribute(main, 'data-kodefy-collection');
  setAttribute(main, 'data-limit', '24');
  appendHtml(main, '<section class="kodefy-collection-heading padding-global" data-label="Shopify Collection Header" data-kodety-section-id="shopify-collection-header"><div class="container-large"><p class="label">Coleção Shopify</p><h1 class="heading-style-h2" data-kodefy-collection-title>Coleção em destaque</h1><p class="text-size-medium" data-kodefy-collection-description>Produtos sincronizados automaticamente pela Shopify.</p></div></section>', true);
  const products = findFirst(main, (node) => isElement(node) && hasAttribute(node, 'data-kodefy-products'));
  if (products) {
    removeAttribute(products, 'data-kodefy-products');
    setAttribute(products, 'data-kodefy-collection-products');
    setAttribute(products, 'data-limit', '24');
  }
}

function transformCart(document, file) {
  for (const node of findAll(document, (candidate) => isElement(candidate))) {
    if (node.tagName === 'smootify-cart') setTag(node, 'div');
  }
  if (file !== 'cart.html') return;
  const root = findFirst(document, (node) => isElement(node) && hasClass(node, 'smootify-cart'));
  if (!root) return;
  const items = findFirst(root, (node) => isElement(node) && hasClass(node, 'cart3_list'));
  if (items) {
    setAttribute(items, 'data-kodefy-cart-items');
    setAttribute(items, 'data-empty-message', 'Seu carrinho está vazio.');
  }
  const item = items && findFirst(items, (node) => isElement(node) && node.tagName === 'cart-item');
  if (item) {
    setTag(item, 'article');
    setAttribute(item, 'data-kodefy-cart-item');
    setAttribute(item, 'data-kodefy-template');
    for (const node of findAll(item, (candidate) => isElement(candidate))) {
      const cartItem = attribute(node, 'cart-item');
      const action = attribute(node, 'data-action');
      if (cartItem === 'title') setAttribute(node, 'data-kodefy-cart-item-title');
      if (cartItem === 'options') setAttribute(node, 'data-kodefy-cart-item-options');
      if (cartItem === 'total' || cartItem === 'price') setAttribute(node, 'data-kodefy-cart-item-price');
      if (cartItem === 'image') setAttribute(node, 'data-kodefy-cart-item-image');
      if (attribute(node, 'product') === 'url' && node.tagName === 'a') setAttribute(node, 'data-kodefy-cart-item-link');
      if (action === 'remove') setAttribute(node, 'data-kodefy-cart-remove');
      if (action === 'minus' || action === 'plus') {
        setAttribute(node, 'data-kodefy-cart-step');
        setAttribute(node, 'data-delta', action === 'minus' ? '-1' : '1');
        setAttribute(node, 'type', 'button');
      }
    }
    const quantity = findFirst(item, (node) => isElement(node, 'input') && attribute(node, 'type') === 'number');
    if (quantity) setAttribute(quantity, 'data-kodefy-cart-quantity');
  }
  for (const node of findAll(root, (candidate) => isElement(candidate))) {
    if (attribute(node, 'cart') === 'total') setAttribute(node, 'data-kodefy-cart-total');
    const label = `${attribute(node, 'value') || ''} ${textContent(node)}`;
    if (/checkout/i.test(label)) {
      setAttribute(node, 'data-kodefy-checkout');
      if (node.tagName === 'input') setAttribute(node, 'type', 'button');
    }
  }
}

function transformAccountPages(document, file) {
  if (!/(^|\/)account(?:\/|\.html$)/i.test(file)) return;
  for (const node of findAll(document, (candidate) => isElement(candidate))) {
    if (classIncludes(node, 'section_account') || classIncludes(node, 'section_order') || ['order-page', 'customer-addresses'].includes(node.tagName)) {
      setAttribute(node, 'hidden');
    }
  }
  const surface = findFirst(document, (node) => isElement(node, 'main'))
    || findFirst(document, (node) => isElement(node) && hasClass(node, 'main-wrapper'))
    || findFirst(document, (node) => isElement(node, 'body'));
  if (!surface) return;
  appendHtml(surface, '<section class="kodefy-account-bridge padding-global" data-label="Shopify Customer Account" data-kodety-section-id="shopify-customer-account"><div class="container-large"><div class="kodefy-account-card"><p class="label">Conta segura Shopify</p><h1 class="heading-style-h2">Sua conta.</h1><p>Pedidos, endereços, rastreio e dados pessoais são gerenciados diretamente no ambiente seguro da Shopify.</p><a class="button" href="#" data-kodefy-account-link>Acessar minha conta Shopify</a></div></div></section>', true);
}

function appendCartDrawer(document, file) {
  const body = findFirst(document, (node) => isElement(node, 'body'));
  if (!body) return;
  const prefix = relativePrefix(file);
  appendHtml(body, `<div class="kodefy-cart-drawer" data-kodefy-cart-drawer aria-hidden="true" data-label="Shopify Cart Drawer"><button class="kodefy-cart-overlay" type="button" data-kodefy-cart-overlay aria-label="Fechar carrinho"></button><aside class="kodefy-cart-panel" role="dialog" aria-modal="true" aria-labelledby="KodefyCartTitle"><header class="kodefy-cart-header"><h2 id="KodefyCartTitle">Seu carrinho</h2><button class="kodefy-cart-close" type="button" data-kodefy-cart-close aria-label="Fechar carrinho">×</button></header><div class="kodefy-cart-items" data-kodefy-cart-items data-empty-message="Seu carrinho está vazio."><article class="kodefy-cart-item" data-kodefy-cart-item data-kodefy-template><a href="${prefix}detail_product.html" data-kodefy-cart-item-link><img src="${prefix}images/6191a88a1c0e39463c2bf022_placeholder-image.svg" alt="Produto" data-kodefy-cart-item-image></a><div class="kodefy-cart-item-copy"><a href="${prefix}detail_product.html" data-kodefy-cart-item-link data-kodefy-cart-item-title>Produto Shopify</a><p data-kodefy-cart-item-options>Opção padrão</p><div class="kodefy-cart-quantity"><button type="button" data-kodefy-cart-step data-delta="-1" aria-label="Diminuir quantidade">−</button><input type="number" min="0" max="99" value="1" data-kodefy-cart-quantity aria-label="Quantidade"><button type="button" data-kodefy-cart-step data-delta="1" aria-label="Aumentar quantidade">+</button></div></div><div class="kodefy-cart-line-end"><strong data-kodefy-cart-item-price>R$ 0,00</strong><button type="button" data-kodefy-cart-remove>Remover</button></div></article></div><footer class="kodefy-cart-footer"><div><span>Total estimado</span><strong data-kodefy-cart-total>R$ 0,00</strong></div><button class="button" type="button" data-kodefy-checkout>Finalizar compra na Shopify</button><a href="${prefix}cart.html" data-kodefy-cart-link>Ver carrinho completo</a></footer></aside></div><div class="kodefy-sr-only" data-kodefy-live aria-live="polite" aria-atomic="true"></div>`);
}

function normalizeCustomElements(document) {
  const replacements = new Map([
    ['smootify-price', 'span'],
    ['smootify-add-to-cart', 'div'],
    ['variant-selector', 'div'],
    ['variant-swatches', 'div'],
    ['quantity-input', 'div'],
    ['store-availability', 'div'],
  ]);
  for (const node of findAll(document, (candidate) => isElement(candidate))) {
    const replacement = replacements.get(node.tagName);
    if (replacement) setTag(node, replacement);
  }
}

function convertHtml(source, file) {
  const document = parse(source);
  removeSmootifyAssets(document);
  labelSections(document, file);
  transformLinksAndSearch(document, file);
  const detailRoot = transformProductDetail(document, file);
  transformProductListings(document, file, detailRoot);
  transformCollection(document, file);
  transformCart(document, file);
  transformAccountPages(document, file);
  appendCartDrawer(document, file);
  normalizeCustomElements(document);
  addThemeAssets(document, file);
  return '<!DOCTYPE html>\n' + serialize(document).replace(/^<!DOCTYPE html>/i, '').trimStart();
}

function searchPageFromShop(source) {
  const document = parse(source);
  const title = findFirst(document, (node) => isElement(node, 'title'));
  if (title) setText(title, 'Buscar produtos — Noise + Kodefy');
  const main = findFirst(document, (node) => isElement(node, 'main'));
  const listing = main && findFirst(main, (node) => isElement(node) && hasAttribute(node, 'data-kodefy-products'));
  if (listing) {
    removeAttribute(listing, 'data-kodefy-products');
    setAttribute(listing, 'data-kodefy-search-results');
    setAttribute(listing, 'data-limit', '24');
  }
  if (main) {
    appendHtml(main, '<section class="kodefy-search-heading padding-global" data-label="Shopify Search Header" data-kodety-section-id="shopify-search-header"><div class="container-large"><p class="label">Catálogo Shopify</p><h1 class="heading-style-h2">Buscar produtos</h1><form class="kodefy-search-form" action="search.html" data-kodefy-search-form><label for="KodefySearchPage">O que você procura?</label><div><input id="KodefySearchPage" name="q" type="search" required placeholder="Produto, marca ou categoria"><button class="button" type="submit">Buscar</button></div></form><p>Resultados para “<strong data-kodefy-search-query></strong>”</p></div></section>', true);
  }
  return '<!DOCTYPE html>\n' + serialize(document).replace(/^<!DOCTYPE html>/i, '').trimStart();
}

const themeCss = `/* Noise Webflow → Kodefy compatibility layer. */
[hidden] { display: none !important; }
[data-kodefy-loading="true"] { opacity: .55; pointer-events: none; }
.kodefy-error, .kodefy-empty { grid-column: 1 / -1; padding: 2rem; border: 1px dashed currentColor; text-align: center; }
.kodefy-sr-only { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.kodefy-product-main-image { display: block; width: 100%; height: 100%; min-height: 32rem; object-fit: cover; }
.kodefy-wishlist-button { display: inline-grid; min-width: 2.75rem; min-height: 2.75rem; place-items: center; border: 1px solid currentColor; background: transparent; color: inherit; cursor: pointer; }
.kodefy-wishlist-button.is-selected, .kodefy-wishlist-button[aria-pressed="true"] { background: #111; color: #fff; }
[data-kodefy-gallery-thumbs] { display: flex; gap: .5rem; overflow: auto; }
[data-kodefy-gallery-thumbs] button { width: 4.5rem; aspect-ratio: 1; padding: 0; overflow: hidden; border: 1px solid currentColor; background: transparent; cursor: pointer; }
[data-kodefy-gallery-thumbs] img { width: 100%; height: 100%; object-fit: cover; }
.kodefy-collection-heading, .kodefy-search-heading, .kodefy-account-bridge { padding-top: clamp(8rem, 14vw, 12rem); padding-bottom: clamp(2rem, 5vw, 5rem); }
.kodefy-account-card { max-width: 48rem; padding: clamp(2rem, 6vw, 5rem); border: 1px solid currentColor; background: #fff; }
.kodefy-account-card p { max-width: 42rem; margin-bottom: 2rem; }
.kodefy-search-form { max-width: 48rem; margin: 2rem 0; }
.kodefy-search-form > div { display: grid; grid-template-columns: 1fr auto; gap: .75rem; }
.kodefy-search-form input { min-height: 3.5rem; padding: .75rem 1rem; border: 1px solid currentColor; background: #fff; color: inherit; }
.kodefy-cart-drawer { position: fixed; z-index: 99999; inset: 0; visibility: hidden; pointer-events: none; }
.kodefy-cart-drawer.is-open { visibility: visible; pointer-events: auto; }
.kodefy-cart-overlay { position: absolute; inset: 0; border: 0; background: rgba(0, 0, 0, .5); opacity: 0; transition: opacity .2s ease; }
.kodefy-cart-drawer.is-open .kodefy-cart-overlay { opacity: 1; }
.kodefy-cart-panel { position: absolute; top: 0; right: 0; display: grid; width: min(31rem, 100%); height: 100%; grid-template-rows: auto 1fr auto; padding: 1.5rem; background: #fff; color: #111; transform: translateX(100%); transition: transform .25s ease; }
.kodefy-cart-drawer.is-open .kodefy-cart-panel { transform: translateX(0); }
.kodefy-cart-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-bottom: 1rem; border-bottom: 1px solid #ddd; }
.kodefy-cart-header h2 { margin: 0; }
.kodefy-cart-close { width: 2.75rem; height: 2.75rem; padding: 0; border: 1px solid #bbb; border-radius: 50%; background: transparent; color: inherit; font-size: 1.5rem; cursor: pointer; }
.kodefy-cart-items { overflow: auto; }
.kodefy-cart-item { display: grid; grid-template-columns: 5rem minmax(0, 1fr) auto; gap: .875rem; padding: 1rem 0; border-bottom: 1px solid #ddd; }
.kodefy-cart-item img { width: 5rem; aspect-ratio: 1; object-fit: cover; }
.kodefy-cart-item-copy > a { color: inherit; font-weight: 700; text-decoration: none; }
.kodefy-cart-item-copy p { margin: .25rem 0 .75rem; color: #666; font-size: .8rem; }
.kodefy-cart-quantity { display: inline-grid; grid-template-columns: 2rem 2.5rem 2rem; border: 1px solid #bbb; }
.kodefy-cart-quantity button, .kodefy-cart-quantity input { width: 100%; min-height: 2rem; padding: 0; border: 0; background: transparent; color: inherit; text-align: center; }
.kodefy-cart-line-end { display: grid; justify-items: end; align-content: start; gap: .5rem; white-space: nowrap; }
.kodefy-cart-line-end button { padding: 0; border: 0; background: transparent; color: #9b1c1c; cursor: pointer; }
.kodefy-cart-footer { display: grid; gap: .75rem; padding-top: 1rem; border-top: 1px solid #ddd; }
.kodefy-cart-footer > div { display: flex; justify-content: space-between; font-size: 1.1rem; }
.kodefy-cart-footer > .button { width: 100%; }
.kodefy-cart-footer > a { color: inherit; text-align: center; }
@media (max-width: 767px) { .kodefy-product-main-image { min-height: 24rem; } .kodefy-search-form > div { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { .kodefy-cart-overlay, .kodefy-cart-panel { transition: none; } }
`;

const themeJs = `(function () {
  'use strict';
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-kodefy-product-quantity-step]');
    if (!button) return;
    var root = button.closest('[data-kodefy-product-detail]');
    var input = root && root.querySelector('[data-kodefy-product-quantity]');
    if (!input) return;
    event.preventDefault();
    input.value = String(Math.max(1, Math.min(99, Number(input.value || 1) + Number(button.dataset.delta || 0))));
  });
  document.addEventListener('keydown', function (event) {
    var control = event.target.closest('[data-kodefy-cart-open]');
    if (control && (event.key === 'Enter' || event.key === ' ')) control.click();
  });
}());
`;

const project = {
  version: 1,
  name: 'Noise — Kodefy Shopify',
  mainHtmlPath: 'index.html',
  homeHtmlPath: 'index.html',
  rootPath: '',
  primaryBreakpoint: { id: 'base', label: 'Primary', mode: 'max-width', width: 1920 },
  breakpoints: [
    { id: 'wide', label: 'Wide', mode: 'min-width', width: 2560 },
    { id: 'notebook', label: 'Notebook', mode: 'max-width', width: 1200 },
    { id: 'tablet', label: 'Tablet', mode: 'max-width', width: 991 },
    { id: 'mobile', label: 'Mobile', mode: 'max-width', width: 479 },
  ],
};

const sourceBuffer = await fs.readFile(input);
const sourceZip = await JSZip.loadAsync(sourceBuffer, { createFolders: true });
const files = new Map();
for (const [rawName, entry] of Object.entries(sourceZip.files)) {
  const name = safeZipPath(rawName);
  if (!name || entry.dir || name === '.DS_Store' || name.startsWith('__MACOSX/')) continue;
  const data = await entry.async('nodebuffer');
  files.set(name, data);
}
if (!files.has('index.html')) throw new Error('O export Webflow precisa conter index.html na raiz.');

const converted = new Map();
for (const [name, data] of files) {
  converted.set(name, /\.html?$/i.test(name) ? Buffer.from(convertHtml(data.toString('utf8'), name)) : data);
}
const shop = converted.get('shop.html');
if (shop) converted.set('search.html', Buffer.from(searchPageFromShop(shop.toString('utf8'))));
if (converted.has('detail_product.html')) converted.set('product.html', converted.get('detail_product.html'));
if (converted.has('detail_collection.html')) converted.set('collection.html', converted.get('detail_collection.html'));
converted.set('css/kodefy-theme.css', Buffer.from(themeCss));
converted.set('js/kodefy-theme.js', Buffer.from(themeJs));
converted.set('.incode/project.json', Buffer.from(JSON.stringify(project, null, 2) + '\n'));
converted.set('README-KODEFY.md', Buffer.from([
  '# Noise — Kodefy Shopify',
  '',
  'Tema convertido do export Webflow para o contrato nativo do Kodefy.',
  '',
  '## Uso',
  '',
  '1. Instale e ative a extensão Kodefy no Kodety.',
  '2. Importe este ZIP ou escolha **Noise — Kodefy Shopify** em Templates.',
  '3. Abra **Integrações → Kodefy Shopify** e conecte o domínio e o token Storefront.',
  '4. Publique as páginas `shop.html`, `detail_product.html`, `detail_collection.html`, `cart.html`, `search.html` e `wishlist.html` nas rotas configuradas.',
  '',
  'Produtos, coleções, variantes, estoque, carrinho, favoritos, busca, conta e checkout usam `data-kodefy-*`. Nenhum token Shopify é gravado neste tema.',
  '',
].join('\n')));

await fs.rm(output, { recursive: true, force: true });
for (const [name, data] of [...converted.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  const target = path.join(output, name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
}

const outputZip = new JSZip();
for (const [name, data] of [...converted.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  outputZip.file(name, data, { date: epoch });
}
await fs.mkdir(path.dirname(archiveOutput), { recursive: true });
await fs.writeFile(archiveOutput, await outputZip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
  platform: 'UNIX',
}));

console.log(`Converted ${[...converted.keys()].filter((name) => /\.html?$/i.test(name)).length} pages to ${output}`);
console.log(`Created ${archiveOutput}`);
