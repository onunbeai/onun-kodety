(function () {
  'use strict';

  if (window.KodefyCommerce) return;

  const configNode = document.getElementById('kodefy-config');
  let config = null;
  try { config = configNode ? JSON.parse(configNode.textContent || '{}') : null; } catch (_) { config = null; }
  if (!config || !config.restUrl) return;

  const storageKey = `kodefy:cart:${config.shopDomain || location.host}`;
  const wishlistKey = `kodefy:wishlist:${config.shopDomain || location.host}`;
  const inflightReads = new Map();
  let cart = null;
  let cartPromise = null;
  let checkoutPromise = null;
  let pendingCheckout = null;

  function route(name, handle) {
    const base = (config.routes && config.routes[name]) || `/${name}/`;
    if (!handle) return base;
    return `${base.replace(/\/+$/, '')}/${encodeURIComponent(handle)}/`;
  }

  function retryDelay(attempt) {
    return new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 250 : 750));
  }

  async function request(path, options) {
    const method = String(options && options.method || 'GET').toUpperCase();
    const retryable = method === 'GET';
    let lastError = null;
    for (let attempt = 0; attempt < (retryable ? 3 : 1); attempt += 1) {
      try {
        const response = await fetch(`${config.restUrl}${path}`, {
          credentials: 'same-origin',
          cache: method === 'GET' ? 'no-store' : 'default',
          ...options,
          headers: { 'Content-Type': 'application/json', ...(options && options.headers) },
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload.ok !== false) return payload.data;
        const error = new Error(payload.message || 'Não foi possível acessar a loja.');
        error.status = response.status;
        error.code = payload.code || '';
        lastError = error;
        if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === 2) throw error;
      } catch (error) {
        lastError = error;
        const status = Number(error && error.status || 0);
        if (!retryable || attempt === 2 || (status && ![408, 425, 429, 500, 502, 503, 504].includes(status))) throw error;
      }
      await retryDelay(attempt);
    }
    throw lastError || new Error('Não foi possível acessar a loja.');
  }

  function api(path, options) {
    const method = String(options && options.method || 'GET').toUpperCase();
    if (method !== 'GET') return request(path, options);
    const existing = inflightReads.get(path);
    if (existing) return existing;
    const pending = request(path, options).finally(() => inflightReads.delete(path));
    inflightReads.set(path, pending);
    return pending;
  }

  function money(value) {
    if (!value) return '';
    const amount = Number(value.amount || 0);
    const currency = value.currencyCode || 'BRL';
    try { return new Intl.NumberFormat(document.documentElement.lang || 'pt-BR', { style: 'currency', currency }).format(amount); }
    catch (_) { return `${currency} ${amount.toFixed(2)}`; }
  }

  function checkoutProviderLabel(provider) {
    return ({ shopify: 'Shopify Checkout', appmax_shopify: 'Shopify + Appmax', yampi: 'Yampi', cartpanda: 'CartPanda', appmax: 'Appmax API', custom: 'Checkout seguro' })[provider] || 'Checkout seguro';
  }

  function text(root, selector, value) {
    const node = root.querySelector(selector);
    if (node) node.textContent = value == null ? '' : String(value);
  }

  function attr(root, selector, name, value) {
    const node = root.matches && root.matches(selector) ? root : root.querySelector(selector);
    if (!node || value == null) return;
    node.setAttribute(name, String(value));
  }

  function all(root, selector) {
    const nodes = Array.from(root.querySelectorAll(selector));
    if (root.matches && root.matches(selector)) nodes.unshift(root);
    return nodes;
  }

  function setLoading(root, loading) {
    root.dataset.kodefyLoading = loading ? 'true' : 'false';
    root.setAttribute('aria-busy', loading ? 'true' : 'false');
  }

  function errorNode(message) {
    const node = document.createElement('p');
    node.className = 'kodefy-error';
    node.setAttribute('role', 'alert');
    node.textContent = message;
    return node;
  }

  function emptyNode(message) {
    const node = document.createElement('p');
    node.className = 'kodefy-empty';
    node.textContent = message;
    return node;
  }

  function announce(message) {
    let live = document.querySelector('[data-kodefy-live]');
    if (!live) {
      live = document.createElement('div');
      live.dataset.kodefyLive = '';
      live.className = 'screen-reader-text';
      live.setAttribute('aria-live', 'polite');
      live.setAttribute('aria-atomic', 'true');
      document.body.appendChild(live);
    }
    live.textContent = '';
    window.setTimeout(() => { live.textContent = message; }, 20);
  }

  function firstVariant(product) {
    const variants = product && product.variants && product.variants.nodes || [];
    return variants.find((variant) => variant.availableForSale) || variants[0] || null;
  }

  function productPrice(product) {
    const variant = firstVariant(product);
    return variant && variant.price || product && product.priceRange && product.priceRange.minVariantPrice;
  }

  function bindProductCard(cardNode, product) {
    cardNode.removeAttribute('data-kodefy-template');
    cardNode.dataset.kodefyProductHandle = product.handle;
    const url = route('product', product.handle);
    cardNode.dataset.kodefyProductUrl = url;
    const image = product.featuredImage || (product.images && product.images.nodes && product.images.nodes[0]);
    text(cardNode, '[data-kodefy-product-title]', product.title);
    text(cardNode, '[data-kodefy-product-vendor]', product.vendor || product.productType || 'Shopify');
    text(cardNode, '[data-kodefy-product-price]', money(productPrice(product)));
    all(cardNode, '[data-kodefy-product-link]').forEach((link) => link.setAttribute('href', url));
    if (image) {
      attr(cardNode, '[data-kodefy-product-image]', 'src', image.url);
      attr(cardNode, '[data-kodefy-product-image]', 'alt', image.altText || product.title);
      if (image.width) attr(cardNode, '[data-kodefy-product-image]', 'width', image.width);
      if (image.height) attr(cardNode, '[data-kodefy-product-image]', 'height', image.height);
    }
    const variant = firstVariant(product);
    const add = cardNode.querySelector('[data-kodefy-add]');
    if (add) {
      add.dataset.variantId = variant && variant.id || '';
      add.dataset.productHandle = product.handle;
      add.disabled = !variant || !variant.availableForSale;
      if (add.disabled) add.textContent = 'Indisponível';
    }
    const wish = cardNode.querySelector('[data-kodefy-wishlist-toggle]');
    if (wish) {
      wish.dataset.productHandle = product.handle;
      updateWishlistButton(wish);
    }
  }

  function productCardTemplate(root) {
    const source = root.querySelector('[data-kodefy-product-card]');
    if (source) root.__kodefyProductTemplate = source.cloneNode(true);
    return root.__kodefyProductTemplate || source;
  }

  function renderCards(root, products, emptyMessage) {
    const source = productCardTemplate(root);
    if (!source) return;
    if (!products.length) {
      root.replaceChildren(emptyNode(emptyMessage || 'Nenhum produto encontrado.'));
      return;
    }
    const fragment = document.createDocumentFragment();
    products.forEach((product) => {
      const cardNode = source.cloneNode(true);
      bindProductCard(cardNode, product);
      fragment.appendChild(cardNode);
    });
    root.replaceChildren(fragment);
  }

  async function loadProductLists() {
    const roots = Array.from(document.querySelectorAll('[data-kodefy-products]'));
    await Promise.all(roots.map(async (root) => {
      if (root.dataset.kodefyReady === 'true') return;
      productCardTemplate(root);
      setLoading(root, true);
      try {
        const params = new URLSearchParams({
          first: root.dataset.limit || '12',
          sort: root.dataset.sort || 'BEST_SELLING',
        });
        if (root.dataset.query) params.set('query', root.dataset.query);
        const result = await api(`/products?${params}`);
        renderCards(root, result.nodes || [], root.dataset.emptyMessage);
        root.dataset.kodefyReady = 'true';
        document.dispatchEvent(new CustomEvent('kodefy:products', { detail: result }));
      } catch (error) {
        root.dataset.kodefyReady = 'error';
        root.replaceChildren(errorNode(error.message));
      } finally { setLoading(root, false); }
    }));
  }

  async function loadCollection() {
    const roots = Array.from(document.querySelectorAll('[data-kodefy-collection]'));
    await Promise.all(roots.map(async (root) => {
      const handle = root.dataset.handle || location.pathname.split('/').filter(Boolean).pop();
      if (!handle || root.dataset.kodefyReady === 'true') return;
      const productsRoot = root.querySelector('[data-kodefy-collection-products]');
      if (productsRoot) productCardTemplate(productsRoot);
      setLoading(root, true);
      try {
        const collection = await api(`/collections/${encodeURIComponent(handle)}?first=${encodeURIComponent(root.dataset.limit || '24')}`);
        text(root, '[data-kodefy-collection-title]', collection.title);
        text(root, '[data-kodefy-collection-description]', collection.description);
        if (productsRoot) renderCards(productsRoot, collection.products && collection.products.nodes || [], root.dataset.emptyMessage);
        root.dataset.kodefyReady = 'true';
      } catch (error) {
        root.dataset.kodefyReady = 'error';
        const productsRoot = root.querySelector('[data-kodefy-collection-products]') || root;
        productsRoot.replaceChildren(errorNode(error.message));
      } finally { setLoading(root, false); }
    }));
  }

  function safeDescription(html) {
    const documentNode = new DOMParser().parseFromString(String(html || ''), 'text/html');
    documentNode.querySelectorAll('script, style, iframe, object, embed').forEach((node) => node.remove());
    documentNode.body.querySelectorAll('*').forEach((node) => {
      Array.from(node.attributes).forEach((attribute) => {
        if (/^on/i.test(attribute.name) || attribute.name === 'style') node.removeAttribute(attribute.name);
      });
    });
    return documentNode.body.innerHTML;
  }

  function bindVariant(root, product, variant) {
    if (!variant) return;
    text(root, '[data-kodefy-product-price]', money(variant.price));
    const compare = root.querySelector('[data-kodefy-product-compare-price]');
    if (compare) {
      compare.textContent = variant.compareAtPrice ? money(variant.compareAtPrice) : '';
      compare.hidden = !variant.compareAtPrice;
    }
    const add = root.querySelector('[data-kodefy-add]');
    if (add) {
      add.dataset.variantId = variant.id;
      add.dataset.productHandle = product.handle;
      add.disabled = !variant.availableForSale;
      add.textContent = variant.availableForSale ? (add.dataset.label || 'Adicionar ao carrinho') : 'Indisponível';
    }
    const inventory = root.querySelector('[data-kodefy-inventory]');
    if (inventory) {
      const quantity = Number(variant.quantityAvailable);
      inventory.classList.toggle('is-out', !variant.availableForSale);
      inventory.classList.toggle('is-low', variant.availableForSale && Number.isFinite(quantity) && quantity <= 5);
      inventory.textContent = !variant.availableForSale
        ? 'Sem estoque'
        : Number.isFinite(quantity) && quantity <= 5
          ? `Últimas ${quantity} unidades`
          : 'Em estoque';
    }
    if (variant.image) setMainImage(root, variant.image.url, variant.image.altText || product.title);
  }

  function bindServerVariant(root, option) {
    if (!option) return;
    text(root, '[data-kodefy-product-price]', option.dataset.variantPrice || '');
    const compare = root.querySelector('[data-kodefy-product-compare-price]');
    if (compare) {
      compare.textContent = option.dataset.variantComparePrice || '';
      compare.hidden = !option.dataset.variantComparePrice;
    }
    const available = option.dataset.variantAvailable === '1';
    const add = root.querySelector('[data-kodefy-add]');
    if (add) {
      add.dataset.variantId = option.value || '';
      add.disabled = !available || !option.value;
      add.textContent = available ? (add.dataset.label || 'Adicionar ao carrinho') : 'Indisponível';
    }
    const inventory = root.querySelector('[data-kodefy-inventory]');
    if (inventory) {
      const quantity = Number(option.dataset.variantQuantity);
      inventory.classList.toggle('is-out', !available);
      inventory.classList.toggle('is-low', available && Number.isFinite(quantity) && quantity <= 5);
      inventory.textContent = !available
        ? 'Sem estoque'
        : Number.isFinite(quantity) && quantity <= 5
          ? `Últimas ${quantity} unidades`
          : 'Em estoque';
    }
    if (option.dataset.variantImage) {
      setMainImage(root, option.dataset.variantImage, option.dataset.variantImageAlt || '');
    }
  }

  function hydrateServerProductDetails() {
    document.querySelectorAll('[data-kodefy-product-detail][data-kodefy-server-ready="true"]').forEach((root) => {
      const select = root.querySelector('[data-kodefy-variant]');
      if (!select || select.dataset.kodefyBound === 'true') return;
      select.dataset.kodefyBound = 'true';
      select.addEventListener('change', () => bindServerVariant(root, select.selectedOptions[0]));
      bindServerVariant(root, select.selectedOptions[0]);
    });
  }

  function setMainImage(root, src, altText) {
    const image = root.querySelector('[data-kodefy-gallery-main]');
    if (!image || !src) return;
    image.src = src;
    image.alt = altText || '';
  }

  function bindGallery(root, product) {
    const images = product.images && product.images.nodes || [];
    if (images[0]) setMainImage(root, images[0].url, images[0].altText || product.title);
    const thumbs = root.querySelector('[data-kodefy-gallery-thumbs]');
    if (!thumbs) return;
    const fragment = document.createDocumentFragment();
    images.forEach((image, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.kodefyGalleryThumb = image.url;
      button.dataset.alt = image.altText || product.title;
      button.setAttribute('aria-label', `Ver imagem ${index + 1}`);
      const img = document.createElement('img');
      img.src = image.url;
      img.alt = '';
      img.loading = 'lazy';
      button.appendChild(img);
      fragment.appendChild(button);
    });
    thumbs.replaceChildren(fragment);
  }

  async function loadProductDetail() {
    const roots = Array.from(document.querySelectorAll('[data-kodefy-product-detail]'));
    await Promise.all(roots.map(async (root) => {
      const handle = root.dataset.handle || location.pathname.split('/').filter(Boolean).pop();
      if (!handle || root.dataset.kodefyReady === 'true') return;
      setLoading(root, true);
      try {
        const product = await api(`/products/${encodeURIComponent(handle)}`);
        root.dataset.productHandle = product.handle;
        text(root, '[data-kodefy-product-title]', product.title);
        text(root, '[data-kodefy-product-vendor]', product.vendor || product.productType || 'Shopify');
        const description = root.querySelector('[data-kodefy-product-description]');
        const nextDescription = safeDescription(product.descriptionHtml || product.description);
        if (description && nextDescription.trim()) description.innerHTML = nextDescription;
        bindGallery(root, product);
        const variants = product.variants && product.variants.nodes || [];
        const select = root.querySelector('[data-kodefy-variant]');
        if (select) {
          const fragment = document.createDocumentFragment();
          variants.forEach((variant) => {
            const option = document.createElement('option');
            option.value = variant.id;
            option.textContent = `${variant.title} — ${money(variant.price)}${variant.availableForSale ? '' : ' · Indisponível'}`;
            option.disabled = !variant.availableForSale;
            fragment.appendChild(option);
          });
          select.replaceChildren(fragment);
          select.addEventListener('change', () => bindVariant(root, product, variants.find((variant) => variant.id === select.value)));
        }
        const initial = firstVariant(product);
        if (select && initial) select.value = initial.id;
        bindVariant(root, product, initial);
        const wish = root.querySelector('[data-kodefy-wishlist-toggle]');
        if (wish) { wish.dataset.productHandle = product.handle; updateWishlistButton(wish); }
        document.title = product.seo && product.seo.title || product.title;
        root.dataset.kodefyReady = 'true';
      } catch (error) {
        root.dataset.kodefyReady = 'error';
        root.appendChild(errorNode(error.message));
      } finally { setLoading(root, false); }
    }));
  }

  function currentWishlist() {
    try {
      const value = JSON.parse(localStorage.getItem(wishlistKey) || '[]');
      return Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(0, 50) : [];
    } catch (_) { return []; }
  }

  function updateWishlistButton(button) {
    const selected = currentWishlist().includes(button.dataset.productHandle || '');
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    button.classList.toggle('is-selected', selected);
    const label = selected ? 'Remover dos favoritos' : 'Adicionar aos favoritos';
    button.setAttribute('aria-label', label);
    if (button.hasAttribute('data-kodefy-wishlist-label')) button.textContent = label;
  }

  function toggleWishlist(handle) {
    if (!handle) return;
    const values = currentWishlist();
    const index = values.indexOf(handle);
    if (index >= 0) values.splice(index, 1); else values.unshift(handle);
    localStorage.setItem(wishlistKey, JSON.stringify(values.slice(0, 50)));
    document.querySelectorAll(`[data-kodefy-wishlist-toggle][data-product-handle="${CSS.escape(handle)}"]`).forEach(updateWishlistButton);
    announce(index >= 0 ? 'Produto removido dos favoritos.' : 'Produto adicionado aos favoritos.');
    document.dispatchEvent(new CustomEvent('kodefy:wishlist', { detail: values }));
  }

  async function loadWishlist() {
    const roots = Array.from(document.querySelectorAll('[data-kodefy-wishlist-products]'));
    if (!roots.length) return;
    const handles = currentWishlist();
    await Promise.all(roots.map(async (root) => {
      productCardTemplate(root);
      if (!handles.length) { root.replaceChildren(emptyNode(root.dataset.emptyMessage || 'Sua lista de favoritos está vazia.')); return; }
      setLoading(root, true);
      try {
        const products = (await Promise.all(handles.map((handle) => api(`/products/${encodeURIComponent(handle)}`).catch(() => null)))).filter(Boolean);
        renderCards(root, products, root.dataset.emptyMessage);
      } finally { setLoading(root, false); }
    }));
  }

  function saveCart(nextCart) {
    cart = nextCart || null;
    pendingCheckout = null;
    if (cart && cart.id) localStorage.setItem(storageKey, cart.id); else localStorage.removeItem(storageKey);
    renderCart();
    document.dispatchEvent(new CustomEvent('kodefy:cart', { detail: cart }));
  }

  async function loadCart(force = false) {
    if (cart && !force) return cart;
    if (cartPromise) return cartPromise;
    const id = cart && cart.id || localStorage.getItem(storageKey);
    if (!id) return null;
    cartPromise = api(`/cart?id=${encodeURIComponent(id)}`)
      .then((value) => { saveCart(value); return value; })
      .catch(() => { saveCart(null); return null; })
      .finally(() => { cartPromise = null; });
    return cartPromise;
  }

  async function cartMutation(payload) {
    const nextCart = await api('/cart', { method: 'POST', body: JSON.stringify(payload) });
    saveCart(nextCart);
    return nextCart;
  }

  function assertVariantInCart(nextCart, variantId) {
    const lines = nextCart && nextCart.lines && nextCart.lines.nodes || [];
    const confirmed = lines.some((line) => (
      Number(line && line.quantity || 0) > 0
      && line.merchandise
      && line.merchandise.id === variantId
    ));
    if (confirmed) return nextCart;
    const error = new Error('A Shopify não confirmou estoque para esta variante no carrinho. Verifique o mercado e os locais de atendimento da loja.');
    error.code = 'kodefy_cart_stock';
    throw error;
  }

  async function addToCart(variantId, quantity) {
    if (!variantId) throw new Error('Selecione uma variação disponível.');
    const existing = await loadCart();
    const create = async () => {
      const created = await cartMutation({ action: 'create', variantId, quantity });
      try { return assertVariantInCart(created, variantId); }
      catch (error) { saveCart(null); throw error; }
    };
    try {
      const nextCart = existing
        ? await cartMutation({ action: 'add', cartId: existing.id, variantId, quantity })
        : await create();
      assertVariantInCart(nextCart, variantId);
      announce('Produto adicionado ao carrinho.');
      openCart();
      return nextCart;
    } catch (error) {
      const emptyExisting = existing && Number(existing.totalQuantity || 0) <= 0;
      const invalidExisting = existing && ['kodefy_cart_id', 'kodefy_not_found'].includes(String(error && error.code || ''));
      if (emptyExisting || invalidExisting) {
        saveCart(null);
        const nextCart = await create();
        announce('Produto adicionado ao carrinho.');
        openCart();
        return nextCart;
      }
      throw error;
    }
  }

  function bindCartItem(node, line) {
    const variant = line.merchandise || {};
    const product = variant.product || {};
    node.removeAttribute('data-kodefy-template');
    node.dataset.lineId = line.id;
    text(node, '[data-kodefy-cart-item-title]', product.title || variant.title || 'Produto');
    text(node, '[data-kodefy-cart-item-options]', (variant.selectedOptions || []).map((item) => item.value).join(' · '));
    text(node, '[data-kodefy-cart-item-price]', money(line.cost && line.cost.totalAmount));
    attr(node, '[data-kodefy-cart-item-link]', 'href', route('product', product.handle));
    if (variant.image) {
      attr(node, '[data-kodefy-cart-item-image]', 'src', variant.image.url);
      attr(node, '[data-kodefy-cart-item-image]', 'alt', variant.image.altText || product.title || '');
    }
    const input = node.querySelector('[data-kodefy-cart-quantity]');
    if (input) { input.value = line.quantity; input.dataset.lineId = line.id; }
    node.querySelectorAll('[data-kodefy-cart-step], [data-kodefy-cart-remove]').forEach((control) => { control.dataset.lineId = line.id; });
  }

  function renderCart() {
    const lines = (cart && cart.lines && cart.lines.nodes || []).filter((line) => Number(line && line.quantity || 0) > 0);
    document.querySelectorAll('[data-kodefy-cart-count]').forEach((node) => { node.textContent = String(cart && cart.totalQuantity || 0); });
    document.querySelectorAll('[data-kodefy-cart-total]').forEach((node) => { node.textContent = money(cart && cart.cost && cart.cost.totalAmount); });
    document.querySelectorAll('[data-kodefy-checkout]').forEach((node) => {
      const available = Boolean(cart && cart.checkoutUrl && Number(cart.totalQuantity || 0) > 0);
      if ('disabled' in node) node.disabled = !available;
      node.setAttribute('aria-disabled', available ? 'false' : 'true');
      if (node.tagName === 'A') {
        const nativeDirect = (!config.checkout || ['shopify', 'appmax_shopify'].includes(config.checkout.provider))
          && (!config.checkout || config.checkout.experience !== 'overlay');
        node.setAttribute('href', available && nativeDirect ? cart.checkoutUrl : '#');
      }
    });
    document.querySelectorAll('[data-kodefy-cart-items]').forEach((root) => {
      const source = root.querySelector('[data-kodefy-cart-item]');
      if (!source && !root.__kodefyTemplate) return;
      if (source) root.__kodefyTemplate = source.cloneNode(true);
      if (!lines.length) { root.replaceChildren(emptyNode(root.dataset.emptyMessage || 'Seu carrinho está vazio.')); return; }
      const fragment = document.createDocumentFragment();
      lines.forEach((line) => {
        const node = root.__kodefyTemplate.cloneNode(true);
        bindCartItem(node, line);
        fragment.appendChild(node);
      });
      root.replaceChildren(fragment);
    });
  }

  function openCart() {
    const drawer = document.querySelector('[data-kodefy-cart-drawer]');
    if (!drawer) { window.location.assign(route('cart')); return; }
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    document.documentElement.style.overflow = 'hidden';
    const close = drawer.querySelector('[data-kodefy-cart-close]');
    if (close) close.focus();
  }

  function closeCart() {
    const drawer = document.querySelector('[data-kodefy-cart-drawer]');
    if (!drawer) return;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
  }

  function checkoutOverlayRoot(selector, opener) {
    const triggerTarget = opener && (
      opener.getAttribute('data-kodety-overlay-target')
      || opener.getAttribute('data-kodety-overlay-open')
      || opener.getAttribute('aria-controls')
    );
    if (triggerTarget) {
      const targetId = triggerTarget.replace(/^#/, '');
      const target = document.getElementById(targetId);
      if (target) return target.matches('[data-kodefy-checkout-overlay]') ? target : target.closest('[data-kodefy-checkout-overlay]');
      try {
        const selected = document.querySelector(triggerTarget);
        if (selected) return selected.matches('[data-kodefy-checkout-overlay]') ? selected : selected.closest('[data-kodefy-checkout-overlay]');
      } catch (_) {}
    }
    const resolvedSelector = selector || config.checkout && config.checkout.overlaySelector || '[data-kodefy-checkout-overlay]';
    try { return document.querySelector(resolvedSelector); } catch (_) { return document.querySelector('[data-kodefy-checkout-overlay]'); }
  }

  function bindCheckoutItem(node, line) {
    const variant = line.merchandise || {};
    const product = variant.product || {};
    node.removeAttribute('data-kodefy-template');
    node.removeAttribute('hidden');
    text(node, '[data-kodefy-checkout-item-title]', product.title || variant.title || 'Produto');
    const options = (variant.selectedOptions || []).map((item) => item.value).filter(Boolean);
    text(node, '[data-kodefy-checkout-item-options]', `${options.join(' · ')}${options.length ? ' · ' : ''}${line.quantity} ${Number(line.quantity) === 1 ? 'item' : 'itens'}`);
    text(node, '[data-kodefy-checkout-item-price]', money(line.cost && line.cost.totalAmount));
    const image = node.querySelector('[data-kodefy-checkout-item-image]');
    if (image && variant.image && variant.image.url) {
      image.src = variant.image.url;
      image.alt = variant.image.altText || product.title || '';
    } else if (image) {
      image.removeAttribute('src');
      image.alt = '';
    }
  }

  function hydrateCheckoutOverlay(root, resolved) {
    text(root, '[data-kodefy-checkout-provider]', checkoutProviderLabel(resolved.provider));
    text(root, '[data-kodefy-checkout-total]', money(cart && cart.cost && cart.cost.totalAmount));
    text(root, '[data-kodefy-checkout-message]', resolved.fallback
      ? `O provedor ${checkoutProviderLabel(resolved.requestedProvider)} não respondeu. Você continuará pelo checkout seguro da Shopify.`
      : `Você continuará pelo ambiente seguro ${checkoutProviderLabel(resolved.provider)}.`);
    const itemsRoot = root.querySelector('[data-kodefy-checkout-items]');
    if (!itemsRoot) return false;
    if (!itemsRoot.__kodefyCheckoutTemplate) {
      const source = itemsRoot.querySelector('[data-kodefy-checkout-item]');
      if (source) itemsRoot.__kodefyCheckoutTemplate = source.cloneNode(true);
    }
    const template = itemsRoot.__kodefyCheckoutTemplate;
    if (!template) return false;
    const fragment = document.createDocumentFragment();
    const lines = (cart && cart.lines && cart.lines.nodes || []).filter((line) => Number(line && line.quantity || 0) > 0);
    lines.forEach((line) => {
      const node = template.cloneNode(true);
      bindCheckoutItem(node, line);
      fragment.appendChild(node);
    });
    if (!lines.length) fragment.appendChild(emptyNode('Seu carrinho está vazio.'));
    itemsRoot.replaceChildren(fragment);
    return lines.length > 0;
  }

  function resetCheckoutOverlay(root) {
    if (!(root instanceof HTMLElement)) return;
    if (root.dataset.state === 'open' && window.KodetyOverlays && typeof window.KodetyOverlays.close === 'function') {
      try { window.KodetyOverlays.close(root, { restoreFocus: false }); } catch (_) {}
    }
    root.dataset.state = 'closed';
    root.removeAttribute('data-kodety-overlay-default-open');
    root.removeAttribute('data-kodefy-checkout-ready');
    const surface = root.querySelector('[data-kodety-overlay-surface]');
    const backdrop = root.querySelector('[data-kodety-overlay-backdrop]');
    [surface, backdrop].forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      if (node instanceof HTMLDialogElement && node.open) {
        try { node.close(); } catch (_) { node.removeAttribute('open'); }
      }
      if (!(node instanceof HTMLDialogElement) && typeof node.hidePopover === 'function') {
        try { node.hidePopover(); } catch (_) {}
      }
      node.hidden = true;
      node.setAttribute('aria-hidden', 'true');
    });
    root.querySelectorAll('[data-kodety-overlay-trigger]').forEach((trigger) => trigger.setAttribute('aria-expanded', 'false'));
    root.querySelectorAll('[data-kodefy-checkout-item][data-kodefy-template]').forEach((template) => { template.hidden = true; });
  }

  function resetCheckoutOverlays() {
    pendingCheckout = null;
    document.querySelectorAll('[data-kodefy-checkout-overlay]').forEach(resetCheckoutOverlay);
  }

  function openCheckoutOverlay(root, opener) {
    if (!(root instanceof HTMLElement)
      || root.getAttribute('data-kodefy-checkout-ready') !== 'true'
      || !cart
      || Number(cart.totalQuantity || 0) <= 0) return false;
    if (window.KodetyOverlays && typeof window.KodetyOverlays.open === 'function') {
      return window.KodetyOverlays.open(root, opener) !== false;
    }
    const surface = root.querySelector('[data-kodety-overlay-surface]');
    const backdrop = root.querySelector('[data-kodety-overlay-backdrop]');
    root.dataset.state = 'open';
    if (backdrop) {
      backdrop.hidden = false;
      backdrop.style.setProperty('z-index', '2147483646', 'important');
      if (typeof backdrop.showPopover === 'function') {
        backdrop.setAttribute('popover', 'manual');
        try { backdrop.showPopover(); } catch (_) {}
      }
    }
    if (surface) {
      surface.hidden = false;
      surface.setAttribute('aria-hidden', 'false');
      surface.style.setProperty('z-index', '2147483647', 'important');
      if (surface instanceof HTMLDialogElement && !surface.open) {
        try { surface.showModal(); } catch (_) { surface.setAttribute('open', ''); }
      } else if (typeof surface.showPopover === 'function') {
        surface.setAttribute('popover', 'manual');
        try { surface.showPopover(); } catch (_) {}
      }
    }
    root.querySelectorAll('[data-kodety-overlay-trigger]').forEach((trigger) => trigger.setAttribute('aria-expanded', 'true'));
    if (surface) surface.focus({ preventScroll: true });
    return true;
  }

  function validCheckoutDestination(value) {
    try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch (_) { return ''; }
  }

  function navigateCheckout(resolved, preparedWindow) {
    const destination = validCheckoutDestination(resolved && resolved.url);
    if (!destination) throw new Error('O provedor retornou um endereço de checkout inválido.');
    document.dispatchEvent(new CustomEvent('kodefy:checkout:redirect', { detail: { ...resolved, url: destination } }));
    if (resolved.openInNewTab) {
      const target = preparedWindow && !preparedWindow.closed ? preparedWindow : window.open('about:blank', '_blank');
      if (!target) {
        announce('O navegador bloqueou a nova aba; o checkout será aberto nesta página.');
        window.location.assign(destination);
        return;
      }
      try { target.opener = null; } catch (_) {}
      target.location.replace(destination);
      return;
    }
    if (preparedWindow && !preparedWindow.closed) preparedWindow.close();
    window.location.assign(destination);
  }

  async function resolveCheckout() {
    if (!cart || !cart.id || Number(cart.totalQuantity || 0) <= 0) throw new Error('Seu carrinho está vazio.');
    if (checkoutPromise) return checkoutPromise;
    checkoutPromise = api('/checkout', {
      method: 'POST',
      body: JSON.stringify({ cartId: cart.id }),
    }).finally(() => { checkoutPromise = null; });
    return checkoutPromise;
  }

  async function startCheckout(control) {
    await loadCart(true);
    if (!cart || !cart.checkoutUrl || Number(cart.totalQuantity || 0) <= 0) throw new Error('Seu carrinho está vazio ou o checkout ainda não está disponível.');
    const configuredOverlay = config.checkout && config.checkout.experience === 'overlay';
    const configuredOverlayRoot = configuredOverlay ? checkoutOverlayRoot(config.checkout.overlaySelector, control) : null;
    let preparedWindow = null;
    if ((!configuredOverlay || !configuredOverlayRoot) && config.checkout && config.checkout.openInNewTab) preparedWindow = window.open('about:blank', '_blank');
    control.dataset.kodefyCheckoutLoading = 'true';
    control.setAttribute('aria-busy', 'true');
    try {
      let resolved;
      try {
        resolved = await resolveCheckout();
      } catch (error) {
        const status = Number(error && error.status || 0);
        const transientFailure = status === 0 || [408, 425, 429, 500, 502, 503, 504].includes(status);
        if (!transientFailure || !config.checkout || !config.checkout.fallbackToShopify) throw error;
        const refreshedCart = await loadCart(true);
        if (!refreshedCart || !refreshedCart.checkoutUrl || Number(refreshedCart.totalQuantity || 0) <= 0) throw error;
        resolved = {
          provider: 'shopify', strategy: 'native', url: refreshedCart.checkoutUrl,
          experience: config.checkout.experience === 'overlay' ? 'overlay' : 'redirect',
          overlaySelector: config.checkout.overlaySelector,
          openInNewTab: Boolean(config.checkout.openInNewTab), fallback: true,
          requestedProvider: config.checkout.provider, fallbackReason: error && error.code || 'kodefy_checkout_unreachable',
        };
      }
      pendingCheckout = resolved;
      document.dispatchEvent(new CustomEvent('kodefy:checkout:ready', { detail: resolved }));
      if (resolved.experience === 'overlay') {
        if (preparedWindow && !preparedWindow.closed) {
          preparedWindow.close();
          preparedWindow = null;
        }
        const overlay = checkoutOverlayRoot(resolved.overlaySelector, control);
        if (overlay) {
          const hydrated = hydrateCheckoutOverlay(overlay, resolved);
          if (hydrated) {
            overlay.setAttribute('data-kodefy-checkout-ready', 'true');
            if (openCheckoutOverlay(overlay, control)) {
              document.dispatchEvent(new CustomEvent('kodefy:checkout:open', { detail: resolved }));
              return;
            }
          }
          overlay.removeAttribute('data-kodefy-checkout-ready');
        }
        announce('Não foi possível preparar o resumo do pedido; continuando para o pagamento seguro.');
      }
      navigateCheckout(resolved, preparedWindow);
    } catch (error) {
      if (preparedWindow && !preparedWindow.closed) preparedWindow.close();
      document.dispatchEvent(new CustomEvent('kodefy:checkout:error', { detail: { error } }));
      throw error;
    } finally {
      control.dataset.kodefyCheckoutLoading = 'false';
      control.setAttribute('aria-busy', 'false');
    }
  }

  async function loadSearch() {
    const roots = Array.from(document.querySelectorAll('[data-kodefy-search-results]'));
    if (!roots.length) return;
    const query = new URLSearchParams(location.search).get('q') || '';
    document.querySelectorAll('[data-kodefy-search-query]').forEach((node) => { node.textContent = query; });
    await Promise.all(roots.map(async (root) => {
      productCardTemplate(root);
      if (!query) { root.replaceChildren(emptyNode('Digite algo para buscar.')); return; }
      setLoading(root, true);
      try {
        const params = new URLSearchParams({ first: root.dataset.limit || '24', query, sort: 'RELEVANCE' });
        const result = await api(`/products?${params}`);
        renderCards(root, result.nodes || [], `Nenhum resultado para “${query}”.`);
      } catch (error) { root.replaceChildren(errorNode(error.message)); }
      finally { setLoading(root, false); }
    }));
  }

  function setupStaticLinks() {
    document.querySelectorAll('[data-kodefy-account-link]').forEach((link) => { if (config.accountUrl) link.href = config.accountUrl; });
    document.querySelectorAll('[data-kodefy-cart-link]').forEach((link) => { link.href = route('cart'); });
    document.querySelectorAll('[data-kodefy-shop-link]').forEach((link) => { link.href = route('shop'); });
    document.querySelectorAll('[data-kodefy-wishlist-link]').forEach((link) => { link.href = route('wishlist'); });
    document.querySelectorAll('[data-kodefy-search-form]').forEach((form) => {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const input = form.querySelector('input[type="search"], input[name="q"]');
        const query = input ? input.value.trim() : '';
        window.location.assign(`${route('search')}?q=${encodeURIComponent(query)}`);
      });
    });
  }

  document.addEventListener('click', async (event) => {
    const checkoutClose = event.target.closest('[data-kodefy-checkout-overlay] [data-kodety-overlay-close], [data-kodefy-checkout-overlay] [data-kodety-overlay-backdrop]');
    if (checkoutClose) {
      event.preventDefault();
      resetCheckoutOverlay(checkoutClose.closest('[data-kodefy-checkout-overlay]'));
      pendingCheckout = null;
      return;
    }
    const checkoutConfirm = event.target.closest('[data-kodefy-checkout-confirm]');
    if (checkoutConfirm) {
      event.preventDefault();
      if (!pendingCheckout || checkoutConfirm.dataset.loading === 'true') return;
      checkoutConfirm.dataset.loading = 'true';
      checkoutConfirm.setAttribute('aria-busy', 'true');
      try { navigateCheckout(pendingCheckout); }
      catch (error) { announce(error.message); window.alert(error.message); }
      finally { checkoutConfirm.dataset.loading = 'false'; checkoutConfirm.setAttribute('aria-busy', 'false'); }
      return;
    }
    const add = event.target.closest('[data-kodefy-add]');
    if (add) {
      event.preventDefault();
      if (add.disabled || add.dataset.loading === 'true') return;
      const detail = add.closest('[data-kodefy-product-detail]');
      const quantityInput = detail && detail.querySelector('[data-kodefy-product-quantity]');
      const quantity = Math.max(1, Math.min(99, Number(quantityInput && quantityInput.value || 1)));
      add.dataset.loading = 'true';
      add.disabled = true;
      try { await addToCart(add.dataset.variantId, quantity); }
      catch (error) { announce(error.message); window.alert(error.message); }
      finally { add.dataset.loading = 'false'; add.disabled = false; }
      return;
    }

    const wish = event.target.closest('[data-kodefy-wishlist-toggle]');
    if (wish) { event.preventDefault(); toggleWishlist(wish.dataset.productHandle); return; }
    if (event.target.closest('[data-kodefy-cart-open]')) { event.preventDefault(); await loadCart(); openCart(); return; }
    if (event.target.closest('[data-kodefy-cart-close], [data-kodefy-cart-overlay]')) { event.preventDefault(); closeCart(); return; }
    const checkout = event.target.closest('[data-kodefy-checkout]');
    if (checkout) {
      event.preventDefault();
      if (checkout.dataset.kodefyCheckoutLoading === 'true' || checkout.getAttribute('aria-disabled') === 'true') return;
      try { await startCheckout(checkout); }
      catch (error) { announce(error.message); window.alert(error.message); }
      return;
    }
    const remove = event.target.closest('[data-kodefy-cart-remove]');
    if (remove && cart) {
      event.preventDefault();
      await cartMutation({ action: 'remove', cartId: cart.id, lineId: remove.dataset.lineId });
      announce('Produto removido do carrinho.');
      return;
    }
    const step = event.target.closest('[data-kodefy-cart-step]');
    if (step && cart) {
      event.preventDefault();
      const item = step.closest('[data-kodefy-cart-item]');
      const input = item && item.querySelector('[data-kodefy-cart-quantity]');
      if (!input) return;
      const quantity = Math.max(0, Math.min(99, Number(input.value || 0) + Number(step.dataset.delta || 0)));
      await cartMutation({ action: quantity === 0 ? 'remove' : 'update', cartId: cart.id, lineId: step.dataset.lineId, quantity });
      return;
    }
    const thumb = event.target.closest('[data-kodefy-gallery-thumb]');
    if (thumb) { event.preventDefault(); setMainImage(thumb.closest('[data-kodefy-product-detail]'), thumb.dataset.kodefyGalleryThumb, thumb.dataset.alt); return; }

    const card = event.target.closest('[data-kodefy-product-card][data-kodefy-product-url]');
    if (card && !event.target.closest('a, button, input, select, textarea, label, [role="button"]')) {
      event.preventDefault();
      window.location.assign(card.dataset.kodefyProductUrl);
    }
  });

  document.addEventListener('change', async (event) => {
    const input = event.target.closest('[data-kodefy-cart-quantity]');
    if (!input || !cart) return;
    const quantity = Math.max(0, Math.min(99, Number(input.value || 0)));
    try { await cartMutation({ action: quantity === 0 ? 'remove' : 'update', cartId: cart.id, lineId: input.dataset.lineId, quantity }); }
    catch (error) { announce(error.message); }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeCart();
    const checkoutOverlay = document.querySelector('[data-kodefy-checkout-overlay][data-state="open"]');
    if (checkoutOverlay) resetCheckoutOverlay(checkoutOverlay);
  });
  document.addEventListener('kodety:overlay-close', (event) => {
    const root = event.detail && event.detail.root;
    if (!(root instanceof HTMLElement) || !root.matches('[data-kodefy-checkout-overlay]')) return;
    root.removeAttribute('data-kodefy-checkout-ready');
    pendingCheckout = null;
  });

  async function init() {
    resetCheckoutOverlays();
    setupStaticLinks();
    hydrateServerProductDetails();
    document.querySelectorAll('[data-kodefy-wishlist-toggle]').forEach(updateWishlistButton);
    if (!config.configured) {
      document.querySelectorAll('[data-kodefy-products], [data-kodefy-product-detail], [data-kodefy-collection], [data-kodefy-search-results]').forEach((root) => root.appendChild(errorNode('Conecte a Shopify em Kodety → Kodefy Shopify.')));
      return;
    }
    await Promise.allSettled([loadCart(), loadProductLists(), loadCollection(), loadProductDetail(), loadSearch(), loadWishlist()]);
    renderCart();
  }

  window.KodefyCommerce = { init, loadCart, addToCart, openCart, closeCart, resolveCheckout, startCheckout, getCart: () => cart };
  window.addEventListener('online', () => { void init(); });
  window.addEventListener('pageshow', (event) => { if (event.persisted) void init(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
}());
