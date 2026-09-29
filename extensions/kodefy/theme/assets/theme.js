class KodefyCartDrawer extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready === 'true') return;
    this.dataset.ready = 'true';
    this.querySelectorAll('[data-cart-drawer-close], #CartDrawer-Overlay').forEach((node) => node.addEventListener('click', () => this.close()));
    this.addEventListener('change', (event) => {
      const input = event.target.closest('[data-cart-quantity]');
      if (input) this.change(input.dataset.line, Number(input.value));
    });
    this.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-cart-remove]');
      if (remove) { event.preventDefault(); this.change(remove.dataset.line, 0); }
    });
  }
  open() { this.classList.add('is-open'); this.setAttribute('aria-hidden', 'false'); document.documentElement.classList.add('cart-open'); this.querySelector('[data-cart-drawer-close]')?.focus(); }
  close() { this.classList.remove('is-open'); this.setAttribute('aria-hidden', 'true'); document.documentElement.classList.remove('cart-open'); }
  async change(line, quantity) {
    this.setAttribute('aria-busy', 'true');
    try {
      await fetch(window.KodefyThemeRoutes.cartChange, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ line: Number(line), quantity }) });
      await window.KodefyTheme.refreshCart(true);
    } finally { this.removeAttribute('aria-busy'); }
  }
}

class KodefySlider extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready === 'true') return;
    this.dataset.ready = 'true';
    const slider = this.querySelector('[data-slider]');
    this.querySelector('[data-slider-prev]')?.addEventListener('click', () => slider?.scrollBy({ left: -slider.clientWidth, behavior: 'smooth' }));
    this.querySelector('[data-slider-next]')?.addEventListener('click', () => slider?.scrollBy({ left: slider.clientWidth, behavior: 'smooth' }));
  }
}

customElements.define('kodefy-cart-drawer', KodefyCartDrawer);
customElements.define('kodefy-slider', KodefySlider);

window.KodefyTheme = {
  announce(message) { const node = document.getElementById('KodefyLiveRegion'); if (node) node.textContent = message; },
  async refreshCart(open) {
    const response = await fetch(`${window.KodefyThemeRoutes.root}?sections=kodefy-cart-drawer`, { headers: { Accept: 'application/json' } });
    const sections = await response.json();
    const html = sections['kodefy-cart-drawer'];
    if (!html) return;
    const documentNode = new DOMParser().parseFromString(html, 'text/html');
    const next = documentNode.querySelector('[data-kodefy-cart-drawer-section]');
    const current = document.querySelector('[data-kodefy-cart-drawer-section]');
    if (next && current) current.replaceWith(next);
    const count = next?.dataset.cartCount || '0';
    const countNode = document.getElementById('HeaderCartCount');
    if (countNode) countNode.textContent = count;
    if (open) document.querySelector('kodefy-cart-drawer')?.open();
  }
};

document.addEventListener('click', (event) => {
  const opener = event.target.closest('[data-cart-drawer-open]');
  if (opener) { event.preventDefault(); document.querySelector('kodefy-cart-drawer')?.open(); }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-product-form]');
  if (!form || !window.fetch) return;
  event.preventDefault();
  const button = form.querySelector('[type="submit"]');
  if (button) button.disabled = true;
  try {
    const response = await fetch(window.KodefyThemeRoutes.cartAdd, { method: 'POST', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: new FormData(form) });
    const result = await response.json();
    if (!response.ok || result.status) throw new Error(result.description || window.KodefyThemeStrings?.addError || 'The product could not be added.');
    await window.KodefyTheme.refreshCart(true);
    window.KodefyTheme.announce(window.KodefyThemeStrings?.addedToCart || 'Product added to cart.');
  } catch (error) { window.KodefyTheme.announce(error.message); }
  finally { if (button) button.disabled = false; }
});

document.addEventListener('shopify:section:load', () => {
  document.querySelectorAll('kodefy-cart-drawer, kodefy-slider').forEach((node) => { node.dataset.ready = 'false'; node.connectedCallback?.(); });
});
