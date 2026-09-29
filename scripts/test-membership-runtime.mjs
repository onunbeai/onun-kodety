import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const sourcePath = new URL('../Wordpress/runtime-assets/membership-runtime.js', import.meta.url);
const source = await readFile(sourcePath, 'utf8');
assert.equal(
  (source.match(/var cleanUrl = new URL\(window\.location\.href\);/g) || []).length,
  1,
  'reset-password deve limpar a URL uma única vez',
);

class FakeElement extends EventTarget {
  constructor() {
    super();
    this.dataset = {};
    this.textContent = '';
  }

  setAttribute() {}
  querySelectorAll() { return []; }
}

class FakeForm extends FakeElement {
  constructor(action, values = {}, attributes = {}) {
    super();
    this.attributes = new Map([
      ['data-kodety-member-form', action],
      ...Object.entries(attributes),
    ]);
    this.values = new Map(Object.entries(values));
    this.controls = [{ disabled: false }];
    this.children = [];
    this.status = new FakeElement();
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  closest() { return null; }
  querySelector(selector) {
    return selector.includes('data-kodety-member-form-status') ? this.status : null;
  }
  querySelectorAll(selector) {
    return selector.includes('button[type="submit"]') ? this.controls : [];
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

class FakeFormData {
  constructor(form) {
    this.values = new Map(form.values);
  }

  get(name) { return this.values.has(name) ? this.values.get(name) : null; }
  has(name) { return this.values.has(name); }
}

class FakeCustomEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.detail = init.detail;
  }
}

class FakeMutationObserver {
  observe() {}
}

const loginForm = new FakeForm('login', {
  email: 'member@example.test',
  password: 'correct horse battery staple',
  remember: '1',
});
const aliasedLoginForm = new FakeForm('member-login', {
  email: 'alias@example.test',
  password: 'correct horse battery staple',
});
const registerForm = new FakeForm('register', {
  email: 'new-member@example.test',
  password: 'correct horse battery staple',
  displayName: 'New Member',
});
const profileForm = new FakeForm('profile', {
  displayName: 'Member Updated',
});
const logoutForm = new FakeForm('logout');
let successEvent = null;
let aliasedSuccessEvent = null;
loginForm.addEventListener('kodety:member-form:success', event => {
  successEvent = event.detail;
});
aliasedLoginForm.addEventListener('kodety:member-form:success', event => {
  aliasedSuccessEvent = event.detail;
});

const calls = [];
const location = {
  href: 'https://example.test/login/',
  origin: 'https://example.test',
  search: '',
  assigned: '',
  assignments: [],
  reloads: 0,
  assign(value) {
    this.assigned = value;
    this.assignments.push(value);
  },
  reload() { this.reloads += 1; },
};
const window = {
  location,
  kodetyMembership: {
    challengeUrl: 'https://example.test/wp-json/kodety/v1/membership/auth/challenge',
    endpoints: {
      login: 'https://example.test/wp-json/kodety/v1/membership/auth/login',
      register: 'https://example.test/wp-json/kodety/v1/membership/auth/register',
      profile: 'https://example.test/wp-json/kodety/v1/membership/me',
      logout: 'https://example.test/wp-json/kodety/v1/membership/auth/logout',
    },
    afterLoginUrl: '/conta/',
    memberCsrf: 'initial-member-csrf',
  },
};
const document = {
  readyState: 'complete',
  documentElement: new FakeElement(),
  querySelectorAll(selector) {
    return selector.includes('data-kodety-member-form')
      ? [loginForm, aliasedLoginForm, registerForm, profileForm, logoutForm]
      : [];
  },
  addEventListener() {},
  createElement() { return new FakeElement(); },
};
const fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  if (String(url).endsWith('/challenge')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ csrfToken: 'challenge-token-123456789012345678901234' }),
    };
  }
  const payload = init.body ? JSON.parse(init.body) : {};
  if (String(url).endsWith('/login')) {
    const alias = payload.login === 'alias@example.test';
    return {
      ok: true,
      status: 200,
      json: async () => ({
        authenticated: true,
        memberCsrf: alias ? 'alias-member-csrf' : 'login-member-csrf',
        redirect_to: alias ? undefined : '/area-do-membro/?source=login',
        user: { id: 7, displayName: 'Member' },
      }),
    };
  }
  if (String(url).endsWith('/register')) {
    return {
      ok: true,
      status: 201,
      json: async () => ({
        authenticated: true,
        memberCsrf: 'register-member-csrf',
        redirect_to: 'https://attacker.example/phishing',
        user: { id: 8, displayName: 'New Member' },
      }),
    };
  }
  if (String(url).endsWith('/me')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        redirect_to: '/nao-redirecionar-perfil/',
        user: { id: 7, displayName: 'Member Updated' },
      }),
    };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({
      authenticated: false,
      redirect_to: '/nao-redirecionar-logout/',
    }),
  };
};

vm.runInContext(
  source,
  vm.createContext({
    console,
    CustomEvent: FakeCustomEvent,
    document,
    Element: FakeElement,
    Event,
    fetch,
    FormData: FakeFormData,
    Headers,
    HTMLFormElement: FakeForm,
    MutationObserver: FakeMutationObserver,
    URL,
    URLSearchParams,
    WeakSet,
    window,
  }),
  { filename: sourcePath.pathname },
);

const submit = new Event('submit', { cancelable: true });
loginForm.dispatchEvent(submit);
await new Promise(resolve => setImmediate(resolve));
await new Promise(resolve => setImmediate(resolve));

assert.equal(submit.defaultPrevented, true, 'o runtime de membro deve capturar o submit');
assert.equal(loginForm.dataset.kodetyMemberBound, 'true');
assert.equal(calls.length, 2, 'login deve obter desafio descartável antes de autenticar');
assert.equal(calls[0].init.method, 'GET');
assert.equal(calls[1].init.headers['X-Kodety-CSRF'], 'challenge-token-123456789012345678901234');
assert.equal(calls[1].init.headers['X-Kodety-Member-CSRF'], undefined);
assert.equal(calls[1].init.headers['X-WP-Nonce'], undefined);
assert.deepEqual(
  JSON.parse(calls[1].init.body),
  {
    login: 'member@example.test',
    password: 'correct horse battery staple',
    remember: true,
  },
);
assert.equal(successEvent?.action, 'login');
assert.equal(successEvent?.response?.authenticated, true);
assert.equal(loginForm.status.dataset.state, 'success');
assert.equal(loginForm.status.textContent, 'Login realizado com sucesso.');
assert.equal(loginForm.children.length, 0, 'o status existente do Builder deve ser reutilizado');
assert.equal(
  Object.prototype.hasOwnProperty.call(successEvent?.response || {}, 'password'),
  false,
  'eventos nunca devem reemitir a credencial',
);
assert.equal(location.assigned, 'https://example.test/area-do-membro/?source=login');
assert.equal(window.kodetyMembership.memberCsrf, 'login-member-csrf');

const aliasedSubmit = new Event('submit', { cancelable: true });
aliasedLoginForm.dispatchEvent(aliasedSubmit);
await new Promise(resolve => setImmediate(resolve));
await new Promise(resolve => setImmediate(resolve));

assert.equal(aliasedSubmit.defaultPrevented, true, 'aliases member-* devem ser capturados');
assert.equal(aliasedSuccessEvent?.action, 'login', 'aliases devem emitir a ação canônica');
assert.equal(calls.length, 4, 'o alias de login deve usar o mesmo fluxo challenge + login');
assert.equal(
  location.assigned,
  'https://example.test/conta/',
  'sem redirect_to, login deve usar o fallback configurado',
);

const registerSubmit = new Event('submit', { cancelable: true });
registerForm.dispatchEvent(registerSubmit);
await new Promise(resolve => setImmediate(resolve));
await new Promise(resolve => setImmediate(resolve));

assert.equal(registerSubmit.defaultPrevented, true, 'cadastro público deve ser capturado');
assert.equal(calls.length, 6, 'cadastro deve usar challenge descartável');
assert.equal(calls[5].init.headers['X-Kodety-CSRF'], 'challenge-token-123456789012345678901234');
assert.equal(calls[5].init.headers['X-WP-Nonce'], undefined);
assert.equal(window.kodetyMembership.memberCsrf, 'register-member-csrf');
assert.equal(
  location.assigned,
  'https://example.test/conta/',
  'redirect_to externo deve ser rejeitado e cair no fallback same-origin',
);
assert.equal(
  location.assignments.includes('https://attacker.example/phishing'),
  false,
  'redirect_to externo nunca deve chegar a window.location.assign',
);

const assignedBeforeProfile = location.assigned;
const profileSubmit = new Event('submit', { cancelable: true });
profileForm.dispatchEvent(profileSubmit);
await new Promise(resolve => setImmediate(resolve));
await new Promise(resolve => setImmediate(resolve));

assert.equal(profileSubmit.defaultPrevented, true, 'perfil público deve permanecer funcional');
assert.equal(calls.length, 7, 'perfil autenticado não deve solicitar challenge descartável');
assert.equal(calls[6].init.method, 'PUT');
assert.equal(calls[6].init.headers['X-Kodety-Member-CSRF'], 'register-member-csrf');
assert.equal(calls[6].init.headers['X-WP-Nonce'], undefined);
assert.equal(calls[6].init.headers['X-Kodety-CSRF'], undefined);
assert.equal(
  location.assigned,
  assignedBeforeProfile,
  'redirect_to da resposta deve ser ignorado fora de login/register',
);

const logoutSubmit = new Event('submit', { cancelable: true });
logoutForm.dispatchEvent(logoutSubmit);
await new Promise(resolve => setImmediate(resolve));
await new Promise(resolve => setImmediate(resolve));

assert.equal(logoutSubmit.defaultPrevented, true, 'logout público deve permanecer funcional');
assert.equal(calls.length, 8, 'logout autenticado não deve solicitar challenge descartável');
assert.equal(calls[7].init.method, 'POST');
assert.equal(calls[7].init.headers['X-Kodety-Member-CSRF'], 'register-member-csrf');
assert.equal(calls[7].init.headers['X-WP-Nonce'], undefined);
assert.equal(calls[7].init.headers['X-Kodety-CSRF'], undefined);
assert.equal(location.reloads, 1, 'logout sem destino configurado deve recarregar a página');
assert.equal(
  location.assigned,
  assignedBeforeProfile,
  'redirect_to da resposta de logout deve ser ignorado',
);

console.log('Membership browser runtime tests passed.');
