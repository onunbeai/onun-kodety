import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
});

function projectWithHtml(html) {
  return {
    name: 'Membership contract',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: 1,
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: html,
      },
      'styles.css': {
        path: 'styles.css',
        mimeType: 'text/css',
        text: 'body{color:#111}',
      },
    },
  };
}

function protectedRule(requirement = { type: 'authenticated' }) {
  return {
    requirement,
    anonymous: { type: 'branch', branch: 'guest' },
    denied: { type: 'branch', branch: 'upgrade' },
  };
}

function gate(id, requirement = { type: 'authenticated' }) {
  return {
    id,
    label: id,
    ...protectedRule(requirement),
  };
}

try {
  const membership = await server.ssrLoadModule('/lib/html-editor/membership.ts');
  const transport = await server.ssrLoadModule('/lib/html-editor/membership-transport.ts');
  const membershipClient = await server.ssrLoadModule('/lib/html-editor/membership-client.ts');

  const defaults = membership.membershipSettingsFromMetadata({});
  assert.deepEqual(
    defaults,
    { version: 1, enabled: false, gates: {}, pages: {} },
    'projects authored before membership must normalize to a disabled opt-in contract',
  );
  assert.equal(
    membership.evaluateMembershipPage(defaults, 'index.html', { authenticated: false }).allowed,
    true,
    'pages without an explicit access rule stay public for backwards compatibility',
  );
  let audienceSettings = {
    version: 1,
    enabled: true,
    gates: {},
    pages: {},
  };
  audienceSettings = membership.updateMembershipAudienceElementOverride(
    audienceSettings,
    'index.html',
    'guest',
    'aud-hero',
    { visible: false, styles: { color: '#777' } },
  );
  audienceSettings = membership.updateMembershipAudienceElementOverride(
    audienceSettings,
    'index.html',
    'member',
    'aud-hero',
    { styles: { color: '#111' } },
  );
  audienceSettings = membership.updateMembershipAudienceElementOverride(
    audienceSettings,
    'index.html',
    'plan:pro',
    'aud-hero',
    { styles: { color: '#09f' } },
  );
  assert.deepEqual(
    membership.membershipAudienceLayersForViewer({
      authenticated: true,
      planKeys: ['pro'],
    }),
    ['member', 'plan:pro'],
    'a plan audience must inherit the shared member layer before its plan layer',
  );
  assert.equal(
    membership.membershipPreviewLayerId({
      authenticated: true,
      planKeys: ['pro', 'business'],
      previewLayer: 'plan:pro',
    }),
    'plan:pro',
    'the Builder must keep one explicit authoring layer while simulating multiple entitlements',
  );
  assert.equal(
    audienceSettings.audienceOverrides['index.html'].guest['aud-hero'].visible,
    false,
    'audience visibility must persist independently from the authored HTML',
  );
  const audienceProject = projectWithHtml(
    '<!doctype html><html><body><main data-kodety-audience-id="aud-hero">Hero</main></body></html>',
  );
  const audienceCompiled = transport.prepareMembershipProjectForTransport(
    audienceProject,
    { projectId: 'audience-project', membership: audienceSettings },
  );
  assert.equal(
    audienceCompiled.files['index.html'].text,
    audienceProject.files['index.html'].text,
    'audience-only pages must keep their public authored HTML intact',
  );
  const audienceRuntime = JSON.parse(
    audienceCompiled.files[transport.MEMBERSHIP_RUNTIME_PATH].text,
  );
  assert.equal(
    audienceRuntime.pages['index.html'].audienceOverrides['plan:pro']['aud-hero'].styles.color,
    '#09f',
    'the private runtime artifact must carry plan-specific visual layers',
  );

  for (const purpose of ['login', 'register', 'forgot-password', 'reset-password', 'profile', 'logout']) {
    const markup = membership.createMembershipFormMarkup(purpose);
    assert.match(
      markup,
      new RegExp(`data-kodety-member-form="${purpose}"`),
      `${purpose} must expose its membership runtime marker`,
    );
    assert.doesNotMatch(
      markup,
      /wp-json|nonce|rest_url|authorization/i,
      `${purpose} must not embed transport details or secrets`,
    );
    for (const tag of ['form', 'button', 'input']) {
      const starts = [...markup.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))]
        .map((match) => match[0]);
      if (!starts.length && tag === 'input') continue;
      assert.ok(
        starts.length > 0 && starts.every((start) => /\bstyle=/.test(start)),
        `${purpose} ${tag} elements must ship with the neutral Insert visual baseline`,
      );
    }
    assert.match(
      markup,
      /border-radius:20px[\s\S]*?border-radius:14px[\s\S]*?background:#2b2b2b[\s\S]*?color:#ffffff/,
      `${purpose} must look intentional before any custom styling`,
    );
  }
  const neutralGateMarkup = membership.createMembershipGateMarkup({
    id: 'neutral-gate',
    label: 'Neutral gate',
  });
  assert.match(
    neutralGateMarkup,
    /border-radius:20px[\s\S]*?data-kodety-access-branch="content" style="[^"]*border-radius:16px/,
    'membership gates inserted from the design catalog must also start as neutral cards',
  );
  assert.equal(
    membership.MEMBERSHIP_PROTECTED_DOWNLOAD_ATTRIBUTE,
    'data-kodety-protected-download',
  );
  assert.equal(membership.isLocalMembershipProtectedDownloadHref('files/course.zip'), true);
  assert.equal(membership.isLocalMembershipProtectedDownloadHref('/downloads/template.zip?version=2'), true);
  assert.equal(membership.isMembershipProtectedDownloadFileTypeSupported('files/course.zip'), true);
  assert.equal(membership.isMembershipProtectedDownloadFileTypeSupported('files/template.html'), false);
  assert.equal(membership.isMembershipProtectedDownloadFileTypeSupported('files/icon.SVG?download=1'), false);
  for (const unsafeHref of [
    '',
    '#arquivo',
    '?download=1',
    '//cdn.example.test/file.zip',
    'https://example.test/file.zip',
    'javascript:alert(1)',
    'data:text/plain,secret',
    'folder\\file.zip',
  ]) {
    assert.equal(
      membership.isLocalMembershipProtectedDownloadHref(unsafeHref),
      false,
      `protected downloads must reject non-project href: ${unsafeHref}`,
    );
  }
  assert.doesNotMatch(
    membership.createMembershipGateMarkup({ id: 'gate-default', label: 'Gate' }),
    /data-kodety-protected-download/,
    'creating a gate must not insert a broken protected download by default',
  );

  const proRule = protectedRule({
    type: 'plans',
    match: 'any',
    planKeys: ['pro', 'business'],
  });
  assert.equal(
    membership.evaluateMembershipRule(proRule, { authenticated: false }, { enabled: true }).state,
    'guest',
    'anonymous viewers must receive the anonymous fallback',
  );
  assert.equal(
    membership.evaluateMembershipRule(
      proRule,
      { authenticated: true, planKeys: ['pro'] },
      { enabled: true },
    ).allowed,
    true,
    'an any-plan rule must accept one matching active plan',
  );
  assert.equal(
    membership.evaluateMembershipRule(
      {
        ...proRule,
        requirement: { ...proRule.requirement, match: 'all' },
      },
      { authenticated: true, planKeys: ['pro'] },
      { enabled: true },
    ).allowed,
    false,
    'an all-plan rule must deny partial matches',
  );
  assert.equal(
    membership.evaluateMembershipRule(
      proRule,
      {
        authenticated: true,
        entitlements: [{
          planKey: 'pro',
          status: 'active',
          endsAt: '2026-01-01T00:00:00.000Z',
        }],
      },
      { enabled: true, now: new Date('2026-02-01T00:00:00.000Z') },
    ).reason,
    'plan-missing',
    'expired entitlements must never grant access',
  );
  assert.equal(
    membership.evaluateMembershipRule(proRule, { authenticated: true, planKeys: ['pro'] }, { enabled: false }).state,
    'misconfigured',
    'protected rules fail closed while membership is disabled',
  );
  const pagePreviewSettings = {
    version: 1,
    enabled: true,
    gates: {},
    pages: { 'index.html': proRule },
  };
  const pagePreviewCanary = 'BUILDER_PAGE_PREVIEW_PRIVATE_CANARY';
  const deniedPagePreview = membership.applyMembershipPreviewToHtml(
    `<main>${pagePreviewCanary}</main>`,
    pagePreviewSettings,
    { authenticated: false },
    'index.html',
  );
  assert.equal(
    deniedPagePreview.includes(pagePreviewCanary),
    false,
    'whole-page preview must not show private content to a denied persona',
  );
  assert.match(
    deniedPagePreview,
    /data-kodety-membership-page-preview="guest"/,
    'whole-page preview must explain the server-side guest fallback',
  );
  assert.equal(
    membership.applyMembershipPreviewToHtml(
      `<main>${pagePreviewCanary}</main>`,
      pagePreviewSettings,
      { authenticated: true, planKeys: ['pro'] },
      'index.html',
    ),
    `<main>${pagePreviewCanary}</main>`,
    'whole-page preview must retain content for an authorized persona',
  );
  assert.deepEqual(
    membership.evaluateMembershipGate(
      { version: 1, enabled: true, gates: {}, pages: {} },
      'missing',
      { authenticated: true, planKeys: ['pro'] },
    ),
    {
      allowed: false,
      state: 'misconfigured',
      reason: 'gate-not-found',
      fallback: { type: 'hide' },
      activePlanKeys: [],
      matchedPlanKeys: [],
      missingPlanKeys: [],
    },
    'unknown gate identifiers must fail closed without returning protected branches',
  );
  assert.equal(
    membership.evaluateMembershipPage(
      { version: 999, enabled: true, pages: {}, gates: {} },
      'index.html',
      { authenticated: true, planKeys: ['pro'] },
    ).state,
    'misconfigured',
    'unknown membership schema versions must fail closed',
  );
  assert.ok(
    membership.validateMembershipSettings({
      version: 1,
      enabled: true,
      gates: {
        overflow: gate('overflow', {
          type: 'plans',
          match: 'any',
          planKeys: Array.from({ length: 101 }, (_, index) => `plan-${index}`),
        }),
      },
      pages: {},
    }).some(issue => issue.code === 'too-many-plan-keys' && issue.severity === 'error'),
    'publication validation must inspect raw plan keys before normalization truncates them',
  );
  assert.ok(
    membership.validateMembershipSettings({
      version: 999,
      enabled: true,
      gates: {},
      pages: {},
    }).some(issue => issue.code === 'schema-version' && issue.severity === 'error'),
    'unsupported raw schema versions must block publication',
  );
  assert.deepEqual(
    membershipClient.normalizeHtmlMembershipMember({
      id: 8,
      email: 'membro@example.com',
      claims: { accountStatus: 'active', plans: ['pro', 'business'] },
    }).planKeys,
    ['pro', 'business'],
    'the Builder member adapter must consume authoritative claims.plans returned by WordPress',
  );
  assert.equal(
    membershipClient.normalizeHtmlMembershipPlan({ id: 3, slug: 'plano-pro', name: 'Pro' }).key,
    'plano-pro',
    'WordPress plan slugs must become stable Builder plan keys',
  );
  assert.throws(
    () => membershipClient.normalizeHtmlMembershipCommerceProvider('unknown-payments'),
    /desconhecido/i,
    'unknown providers must fail closed instead of being mislabeled as Stripe',
  );
  assert.equal(
    membershipClient.normalizeHtmlMembershipCommerceProvider('hot-mart'),
    'hotmart',
    'Hotmart aliases must normalize to the canonical provider key',
  );
  assert.equal(
    membershipClient.normalizeHtmlMembershipCommerceProvider('Ticto'),
    'ticto',
    'Ticto must be available in the Builder commerce contract',
  );
  const commerceLandingUrl = `https://example.test/?kodety_checkout=${'A'.repeat(43)}`;
  assert.equal(
    membershipClient.htmlMembershipCommerceRequiresCustomerEmail('iugu'),
    true,
    'the client contract must expose Iugu hosted-invoice e-mail requirements',
  );
  assert.equal(
    membershipClient.htmlMembershipCommerceSupportsAnonymousCheckoutHref('iugu'),
    false,
    'a provider name alone must not be enough to advertise an anonymous checkout href',
  );
  assert.equal(
    membershipClient.htmlMembershipCommerceSupportsAnonymousCheckoutHref(
      'iugu',
      commerceLandingUrl,
    ),
    true,
    'the same-site landing makes Iugu safe for anonymous buyers by capturing e-mail first',
  );
  assert.equal(
    membershipClient.htmlMembershipCommerceRequiresCustomerEmail('woovi'),
    true,
    'Woovi membership checkout must collect e-mail because a completed Pix does not guarantee identity',
  );
  assert.equal(
    membershipClient.htmlMembershipCommerceSupportsAnonymousCheckoutHref(
      'woovi',
      commerceLandingUrl,
    ),
    true,
    'the same-site landing makes Woovi safe for anonymous membership checkout',
  );
  assert.equal(
    membershipClient.htmlMembershipCommerceSupportsAnonymousCheckoutHref(
      'stripe',
      commerceLandingUrl,
    ),
    true,
    'all providers may use the versioned e-mail-capture landing',
  );
  assert.equal(
    membershipClient.htmlMembershipCommerceSupportsAnonymousCheckoutHref(
      'stripe',
      'https://example.test/wp-json/kodety/v1/members/commerce/buy/legacy',
    ),
    false,
    'legacy REST/provider URLs must not be mistaken for the stable public landing',
  );
  assert.deepEqual(
    membershipClient.normalizeHtmlMembershipCommerceOverview({
      connections: { total: 3, active: 2, attention: 1 },
      sales: { total: 14, paid: 10, pending: 3, refunded: 1 },
      subscriptions: { total: 7, active: 5, trialing: 1, pastDue: 1 },
      unlinkedSales: 2,
      providers: [{
        id: 'stripe',
        label: 'Stripe',
        available: true,
        capabilities: { checkout: true, subscriptions: true },
      }],
    }),
    {
      providers: [{
        id: 'stripe',
        label: 'Stripe',
        available: true,
        capabilities: ['checkout', 'subscriptions'],
      }],
      connectionCount: 3,
      activeConnectionCount: 2,
      attentionConnectionCount: 1,
      mappedPlanCount: 0,
      saleCount: 14,
      paidSaleCount: 10,
      pendingSaleCount: 3,
      refundedSaleCount: 1,
      activeSubscriptionCount: 5,
      trialingSubscriptionCount: 1,
      pastDueSubscriptionCount: 1,
      unlinkedSaleCount: 2,
    },
    'commerce overview must consume the canonical nested checkout projection',
  );
  assert.equal(
    membershipClient.normalizeHtmlMembershipCommerceConnection({
      id: 'connection-1',
      provider: 'asaas',
      enabled: true,
      status: 'unverified',
      settings: { environment: 'sandbox' },
      capabilities: { payments: true, subscriptions: true },
      credentials: { apiKey: true, webhookToken: true },
      lastSyncedAt: '2026-07-23T12:00:00Z',
    }).environment,
    'sandbox',
    'connection environment must remain separate from payment/subscription mode',
  );
  assert.equal(
    membershipClient.normalizeHtmlMembershipCommerceConnection({
      id: 'connection-1',
      provider: 'asaas',
      lastSyncedAt: '2026-07-23T12:00:00Z',
    }).lastSyncedAt,
    '2026-07-23T12:00:00Z',
    'the client must preserve the reconciliation timestamp returned by WordPress',
  );
  const pendingPagBankConnection = membershipClient.normalizeHtmlMembershipCommerceConnection({
    id: 'pagbank-connection',
    provider: 'pagbank',
    enabled: true,
    status: 'unverified',
    capabilities: { payments: true, subscriptions: false },
    credentials: { token: true },
  });
  assert.equal(pendingPagBankConnection.status, 'pending');
  assert.equal(
    membershipClient.htmlMembershipCommerceConnectionCanCreateMapping(
      pendingPagBankConnection,
    ),
    true,
    'an enabled pending connection must remain mappable when the provider has no read-only test endpoint',
  );
  assert.equal(
    membershipClient.htmlMembershipCommerceConnectionCanCreateMapping({
      enabled: true,
      status: 'error',
    }),
    false,
    'connections in error must not be offered to new mappings',
  );
  assert.equal(
    membershipClient.htmlMembershipCommerceConnectionCanCreateMapping({
      enabled: false,
      status: 'pending',
    }),
    false,
    'disabled pending connections must not be offered to new mappings',
  );
  const normalizedStripeProducts = membershipClient.normalizeHtmlMembershipCommerceProducts([
    {
      id: 'prod_pro',
      name: 'Plano Pro',
      mode: 'payment',
      priceId: 'price_once',
      amount: 9900,
      currency: 'BRL',
    },
    {
      id: 'prod_pro',
      name: 'Plano Pro',
      mode: 'subscription',
      priceId: 'price_monthly',
      amount: 2900,
      currency: 'BRL',
      interval: 'month',
    },
  ]);
  assert.equal(
    normalizedStripeProducts.length,
    1,
    'flat Stripe price rows must merge into one selectable product',
  );
  assert.deepEqual(
    normalizedStripeProducts[0].prices.map(price => [price.id, price.mode]),
    [['price_once', 'payment'], ['price_monthly', 'subscription']],
    'each Stripe price must retain its own purchase mode after product merging',
  );
  const normalizedCommerceMapping = membershipClient.normalizeHtmlMembershipCommerceMapping({
    id: 'mapping-1',
    connectionId: 'connection-1',
    provider: 'stripe',
    planId: 3,
    planSlug: 'pro',
    mode: 'subscription',
    publicUrl: commerceLandingUrl,
  });
  assert.equal(
    normalizedCommerceMapping.mode,
    'subscription',
    'mapping purchase mode must not be normalized as a live/test environment',
  );
  assert.match(
    normalizedCommerceMapping.publicUrl,
    /[?&]kodety_checkout=/,
    'the client must preserve the same-site e-mail-capture landing instead of a provider session',
  );
  assert.equal(
    membershipClient.normalizeHtmlMembershipCommerceSale({
      id: 'sale-1',
      provider: 'stripe',
      userId: 0,
      amount: 9990,
      currency: 'brl',
    }).userId,
    null,
    'unlinked checkout sales must not expose WordPress user ID zero as a manageable member',
  );

  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes('/overview')) {
        return new Response(JSON.stringify({
          enabled: true,
          memberCount: 2,
          activeMemberCount: 1,
          planCount: 1,
          capabilities: {
            manage: true,
            assign: true,
            commerce: true,
            createUsers: true,
            manageMembers: true,
            managePlans: true,
            manageSettings: true,
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (new URL(url).pathname.endsWith('/members')) {
        return new Response(JSON.stringify({
          items: [{ id: 1, email: 'one@example.com', claims: { plans: ['pro'] } }],
          page: 1,
          perPage: 20,
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-WP-Total': '41',
            'X-WP-TotalPages': '3',
          },
        });
      }
      if (url.includes('/plans')) {
        const page = Number(new URL(url).searchParams.get('page') || 1);
        return new Response(JSON.stringify({
          items: page === 1
            ? Array.from({ length: 100 }, (_, index) => ({
              id: index + 1,
              slug: `plan-${index + 1}`,
              name: `Plano ${index + 1}`,
            }))
            : [{ id: 101, slug: 'plan-101', name: 'Plano 101' }],
          page,
          perPage: 100,
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-WP-Total': '101',
            'X-WP-TotalPages': '2',
          },
        });
      }
      return new Response(JSON.stringify({ enabled: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const client = membershipClient.createHtmlMembershipClient({
      baseUrl: 'https://example.test/',
      projectId: 'project-scope',
      overviewUrl: '/wp-json/kodety/v1/membership/overview',
      usersUrl: '/wp-json/kodety/v1/membership/members',
      plansUrl: '/wp-json/kodety/v1/membership/plans',
      settingsUrl: '/wp-json/kodety/v1/membership/settings',
      activationUrl: '/wp-json/kodety/v1/membership/settings',
      nonce: 'rest-nonce',
    });
    const overview = await client.loadOverview();
    assert.equal(overview.capabilities.createMembers, true);
    assert.equal(overview.capabilities.assignPlans, true);
    assert.equal(overview.capabilities.manageCommerce, true);
    assert.equal(
      new URL(requests.at(-1).url).searchParams.get('project'),
      'project-scope',
      'overview requests must be scoped to the current Builder project',
    );
    const membersPage = await client.loadMembers({ page: 1, perPage: 20 });
    assert.equal(membersPage.total, 41);
    assert.equal(membersPage.totalPages, 3);
    assert.equal(
      (await client.loadPlans()).length,
      101,
      'the Builder must paginate the complete plan catalog',
    );
    await client.setEnabled(true);
    const activationRequest = requests.find(request =>
      request.url.includes('/settings') && request.init.method === 'POST',
    );
    assert.deepEqual(
      JSON.parse(activationRequest.init.body),
      { enabled: true, projectId: 'project-scope' },
      'activation must opt in both the site runtime and the current project',
    );
    assert.equal(
      new Headers(activationRequest.init.headers).get('X-WP-Nonce'),
      'rest-nonce',
      'membership mutations must carry the WordPress REST nonce',
    );
    await client.saveSettings({
      enabled: false,
      registrationEnabled: true,
      requireEmailVerification: false,
      enabledProjects: ['stale-project'],
      defaultRole: 'subscriber',
      auditRetentionDays: 730,
      eventRetentionDays: 365,
      loginPageUrl: '/entrar/',
      accountPageUrl: '/conta/',
      upgradePageUrl: '/planos/',
      resetPageUrl: '/redefinir-senha/',
      afterLoginUrl: '/conta/',
      afterLogoutUrl: '/',
    });
    const settingsRequest = requests.find(request =>
      request.url.includes('/settings') && request.init.method === 'PUT',
    );
    const settingsBody = JSON.parse(settingsRequest.init.body);
    assert.equal(settingsBody.resetPageUrl, '/redefinir-senha/');
    assert.equal(
      Object.prototype.hasOwnProperty.call(settingsBody, 'enabledProjects'),
      false,
      'settings edits must not overwrite the project activation allow-list',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(settingsBody, 'enabled'),
      false,
      'settings edits must not change site activation behind the project opt-in flow',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const commerceRequests = [];
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      commerceRequests.push({ url, init });
      if (url.endsWith('/checkout-links')) {
        return new Response(JSON.stringify({
          id: 'checkout-1',
          provider: 'stripe',
          url: 'https://checkout.stripe.com/c/pay/test',
          expiresAt: '2026-07-23T12:00:00Z',
        }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/sync')) {
        return new Response(JSON.stringify({
          checked: 8,
          projected: 3,
          ignored: 4,
          failed: 1,
          staleEventsRecovered: 2,
          piiPurged: 1,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/mappings/mapping-1')) {
        return new Response(JSON.stringify({
          id: 'mapping-1',
          connectionId: 'connection-1',
          planId: 3,
          provider: 'stripe',
          externalPriceId: 'price_monthly',
          mode: 'subscription',
          status: 'paused',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/members/7/access')) {
        return new Response(JSON.stringify({
          access: 'revoked',
          billingUnaffected: true,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/members/7/access-link')) {
        return new Response(JSON.stringify({
          url: 'https://example.test/?kodety_member_access=token',
          expiresAt: '2026-07-23T12:00:00Z',
        }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/members/7/reset-link')) {
        return new Response(JSON.stringify({
          url: 'https://example.test/wp-login.php?action=rp&key=token',
          expiresAt: null,
        }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      if (new URL(url).pathname.endsWith('/sales')) {
        return new Response(JSON.stringify({
          items: [{
            id: 'sale-1',
            provider: 'stripe',
            userId: 7,
            memberEmail: 'member@example.test',
            amount: 12990,
            currency: 'BRL',
            status: 'paid',
          }],
          total: 21,
          page: 2,
          perPage: 20,
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-WP-TotalPages': '2',
          },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const commerceClient = membershipClient.createHtmlMembershipClient({
      baseUrl: 'https://example.test/',
      overviewUrl: '/membership/overview',
      usersUrl: '/membership/members',
      plansUrl: '/membership/plans',
      settingsUrl: '/membership/settings',
      commerceBaseUrl: '/wp-json/kodety/v1/members/commerce',
      nonce: 'commerce-nonce',
    });
    assert.equal(commerceClient.commerceAvailable, true);
    const syncResult = await commerceClient.syncCommerce(25);
    assert.equal(syncResult.projected, 3);
    const syncRequest = commerceRequests.find(request => request.url.endsWith('/sync'));
    assert.equal(syncRequest.init.method, 'POST');
    assert.deepEqual(JSON.parse(syncRequest.init.body), { limit: 25 });
    await commerceClient.updateCommerceMapping('mapping-1', {
      externalPriceId: 'price_monthly',
      currency: 'BRL',
      amount: 2900,
      status: 'paused',
    });
    const mappingUpdateBody = JSON.parse(
      commerceRequests.find(request => request.url.endsWith('/mappings/mapping-1')).init.body,
    );
    assert.equal(mappingUpdateBody.status, 'paused');
    assert.equal(
      Object.prototype.hasOwnProperty.call(mappingUpdateBody, 'connectionId'),
      false,
      'mapping edits must not resend immutable connection identity',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(mappingUpdateBody, 'mode'),
      false,
      'mapping edits must not resend immutable purchase mode',
    );
    await commerceClient.createCheckoutLink({
      connectionId: 'connection-1',
      planId: 3,
      userId: 7,
      mode: 'subscription',
      successUrl: 'https://example.test/obrigado/',
      cancelUrl: 'https://example.test/planos/',
      customerEmail: 'buyer@example.test',
    });
    const checkoutBody = JSON.parse(
      commerceRequests.find(request => request.url.endsWith('/checkout-links')).init.body,
    );
    assert.equal(checkoutBody.mode, 'subscription');
    assert.equal(
      checkoutBody.userId,
      7,
      'an administrative checkout for an existing member must carry authoritative user identity',
    );
    assert.equal(
      checkoutBody.customerEmail,
      'buyer@example.test',
      'provider-required customer e-mail must reach the private checkout endpoint',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(checkoutBody, 'environment'),
      false,
      'checkout creation must send purchase mode without leaking connection environment',
    );
    const accessResult = await commerceClient.changeMemberAccess(7, {
      planId: 3,
      action: 'revoke',
      reason: 'Solicitação administrativa',
    });
    assert.equal(accessResult.billingUnaffected, true);
    assert.match(
      commerceRequests.find(request => request.url.endsWith('/members/7/access')).url,
      /\/members\/7\/access$/,
      'manual access blocks must use the dedicated checkout access endpoint',
    );
    assert.match(
      (await commerceClient.createMemberAccessLink(7)).url,
      /kodety_member_access=/,
      'access links must be requested on demand from WordPress',
    );
    assert.match(
      (await commerceClient.createMemberResetLink(7)).url,
      /action=rp/,
      'password-reset links must be requested on demand from WordPress',
    );
    await commerceClient.sendMemberResetEmail(7);
    assert.ok(
      commerceRequests.some(request => request.url.endsWith('/members/7/reset-email')),
      'reset e-mail delivery must use the private backend action',
    );
    const salesPage = await commerceClient.loadCommerceSales({
      page: 2,
      provider: 'stripe',
      status: 'paid',
    });
    assert.equal(salesPage.total, 21);
    assert.equal(salesPage.items[0].amount, 12990);
    const salesRequest = commerceRequests.find(request => request.url.includes('/sales?'));
    assert.equal(new URL(salesRequest.url).searchParams.get('provider'), 'stripe');
    assert.equal(new URL(salesRequest.url).searchParams.get('status'), 'paid');
    assert.equal(
      new Headers(commerceRequests.at(-1).init.headers).get('X-WP-Nonce'),
      'commerce-nonce',
      'commerce reads and mutations must remain protected by the WordPress REST nonce',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const unchanged = projectWithHtml('<!doctype html><html><body><main>Public</main></body></html>');
  const unchangedResult = transport.prepareMembershipProjectForTransport(unchanged, {
    projectId: 'project-safe',
    membership: { version: 1, enabled: true, gates: {}, pages: {} },
  });
  assert.equal(
    unchangedResult,
    unchanged,
    'enabling the manager without gates or protected pages must preserve the project byte-for-byte',
  );

  const legacyAttributeProject = projectWithHtml(
    '<!doctype html><html><body><main data-kodety-access-gate="legacy-widget">Legacy</main></body></html>',
  );
  assert.equal(
    transport.prepareMembershipProjectForTransport(
      legacyAttributeProject,
      { projectId: 'legacy-project' },
    ),
    legacyAttributeProject,
    'projects without a membership contract must ignore coincidental legacy attributes',
  );
  for (const internalAttribute of [
    'data-kodety-access-placeholder',
    'data-kodety-page-access-placeholder',
    'data-kodety-protected-asset',
  ]) {
    assert.throws(
      () => transport.prepareMembershipProjectForTransport(
        projectWithHtml(
          `<!doctype html><html><body><main ${internalAttribute}="forged">Public</main></body></html>`,
        ),
        {
          projectId: 'reserved-marker-project',
          membership: { version: 1, enabled: true, gates: {}, pages: {} },
        },
      ),
      /marcador interno reservado/,
      `${internalAttribute} must remain transport-owned and impossible to forge in authored HTML`,
    );
  }
  assert.throws(
    () => transport.prepareMembershipProjectForTransport(
      legacyAttributeProject,
      {
        projectId: 'disabled-project',
        membership: { version: 1, enabled: false, gates: {}, pages: {} },
      },
    ),
    /Área de Membros está desativada/,
    'an explicit disabled membership contract must not publish markup that appears protected',
  );

  const canary = 'TOP_SECRET_CANARY_7db3d8';
  const source = `<!doctype html><html><body>
<main>
  <section data-kodety-access-gate="pro">
    <div data-kodety-access-branch="content"><p>${canary}</p></div>
    <div data-kodety-access-branch="guest"><p>Entre para continuar.</p></div>
    <div data-kodety-access-branch="upgrade"><p>Faça upgrade.</p></div>
  </section>
</main>
</body></html>`;
  const privateProject = projectWithHtml(source);
  const privateMetadata = {
    projectId: 'project-private',
    membership: {
      version: 1,
      enabled: true,
      gates: {
        pro: gate('pro', { type: 'plans', match: 'any', planKeys: ['pro'] }),
      },
      pages: {},
    },
  };
  const compiled = transport.prepareMembershipProjectForTransport(privateProject, privateMetadata);
  const publicHtml = compiled.files['index.html'].text;
  assert.equal(
    publicHtml.includes(canary),
    false,
    'protected canary content must be absent from public HTML',
  );
  assert.match(
    publicHtml,
    /data-kodety-access-placeholder="pro:1"/,
    'public HTML must retain only an opaque runtime placeholder',
  );
  assert.ok(
    compiled.files[transport.MEMBERSHIP_RUNTIME_PATH],
    'the private runtime artifact must be emitted under .incode',
  );
  assert.equal(
    transport.MEMBERSHIP_RUNTIME_PATH,
    '.incode/membership/runtime.json',
    'private membership content must never use a public theme path',
  );
  const runtime = JSON.parse(compiled.files[transport.MEMBERSHIP_RUNTIME_PATH].text);
  assert.equal(runtime.enabled, true);
  assert.match(
    runtime.pages['index.html'].gates['pro:1'].protectedHtml,
    new RegExp(canary),
    'the private runtime artifact must retain the authorized branch',
  );

  const hydrated = transport.hydrateMembershipProject(compiled);
  assert.equal(
    hydrated.files['index.html'].text,
    source,
    'hydration must restore the exact authoring HTML',
  );
  assert.equal(
    hydrated.files[transport.MEMBERSHIP_RUNTIME_PATH],
    undefined,
    'hydration must remove the transport-only runtime artifact',
  );

  assert.throws(
    () => transport.prepareMembershipProjectForTransport(
      projectWithHtml('<section data-kodety-access-gate="unknown"><div data-kodety-access-branch="content">secret</div></section>'),
      {
        membership: { version: 1, enabled: true, gates: {}, pages: {} },
      },
    ),
    /regra de acesso inexistente “unknown”/,
    'publishing markup that references an unknown gate must fail closed',
  );
  assert.throws(
    () => transport.prepareMembershipProjectForTransport(
      projectWithHtml('<main>Public</main>'),
      {
        projectId: 'project-missing-page',
        membership: {
          version: 1,
          enabled: true,
          gates: {},
          pages: { 'missing.html': protectedRule() },
        },
      },
    ),
    /não possui um arquivo HTML correspondente/,
    'a stale protected page rule must block publication instead of becoming public',
  );

  const outerCanary = 'OUTER_PRIVATE_CANARY_12d';
  const innerCanary = 'INNER_PRIVATE_CANARY_34e';
  const nestedSource = `<!doctype html><html><body>
<section data-kodety-access-gate="members">
  <div data-kodety-access-branch="content">
    <p>${outerCanary}</p>
    <section data-kodety-access-gate="pro">
      <div data-kodety-access-branch="content"><p>${innerCanary}</p></div>
      <div data-kodety-access-branch="guest"><p>Inner login</p></div>
      <div data-kodety-access-branch="upgrade"><p>Inner upgrade</p></div>
    </section>
  </div>
  <div data-kodety-access-branch="guest"><p>Outer login</p></div>
  <div data-kodety-access-branch="upgrade"><p>Outer upgrade</p></div>
</section>
</body></html>`;
  const nestedCompiled = transport.prepareMembershipProjectForTransport(
    projectWithHtml(nestedSource),
    {
      projectId: 'project-nested',
      membership: {
        version: 1,
        enabled: true,
        gates: {
          members: gate('members'),
          pro: gate('pro', { type: 'plans', match: 'any', planKeys: ['pro'] }),
        },
        pages: {},
      },
    },
  );
  const nestedPublic = nestedCompiled.files['index.html'].text;
  assert.equal(nestedPublic.includes(outerCanary), false);
  assert.equal(nestedPublic.includes(innerCanary), false);
  const nestedRuntime = JSON.parse(
    nestedCompiled.files[transport.MEMBERSHIP_RUNTIME_PATH].text,
  );
  const nestedGates = nestedRuntime.pages['index.html'].gates;
  assert.equal(Object.keys(nestedGates).length, 2, 'nested gates must compile independently');
  const outerGate = Object.values(nestedGates).find(item => item.gateId === 'members');
  const innerGate = Object.values(nestedGates).find(item => item.gateId === 'pro');
  assert.ok(outerGate && innerGate, 'nested compilation must retain both gate identities');
  assert.match(
    outerGate.protectedHtml,
    new RegExp(`data-kodety-access-placeholder="${innerGate.id}"`),
    'an authorized outer branch must retain an opaque placeholder for its nested gate',
  );
  assert.match(innerGate.protectedHtml, new RegExp(innerCanary));
  assert.equal(
    transport.hydrateMembershipProject(nestedCompiled).files['index.html'].text,
    nestedSource,
    'nested gate hydration must restore the original editable tree exactly',
  );
  assert.throws(
    () => transport.prepareMembershipProjectForTransport(
      projectWithHtml(`<!doctype html><html><body>
        <section data-kodety-access-gate="members">
          <div data-kodety-access-branch="content">Members</div>
          <section data-kodety-access-gate="pro">
            <div data-kodety-access-branch="content">PRO_OUTSIDE_CONTENT</div>
          </section>
        </section>
      </body></html>`),
      {
        projectId: 'project-invalid-nesting',
        membership: {
          version: 1,
          enabled: true,
          gates: {
            members: gate('members'),
            pro: gate('pro', { type: 'plans', match: 'any', planKeys: ['pro'] }),
          },
          pages: {},
        },
      },
    ),
    /gate fora do branch content/,
    'a nested gate outside its parent content branch must fail closed',
  );

  const pageCanary = 'WHOLE_PAGE_PRIVATE_CANARY';
  const pageSource = `<!doctype html><html lang="pt-BR"><body>${pageCanary}</body></html>`;
  const pageCompiled = transport.prepareMembershipProjectForTransport(
    projectWithHtml(pageSource),
    {
      projectId: 'project-page',
      membership: {
        version: 1,
        enabled: true,
        gates: {},
        pages: { 'index.html': protectedRule() },
      },
    },
  );
  assert.equal(pageCompiled.files['index.html'].text.includes(pageCanary), false);
  assert.match(pageCompiled.files['index.html'].text, /data-kodety-page-access-placeholder="index.html"/);
  assert.match(
    JSON.parse(pageCompiled.files[transport.MEMBERSHIP_RUNTIME_PATH].text)
      .pages['index.html'].protectedHtml,
    new RegExp(pageCanary),
  );

  const downloadBytes = new TextEncoder().encode('PRIVATE_DOWNLOAD_CANARY_91f4');
  const downloadSource = `<!doctype html><html><body>
    <section data-kodety-access-gate="downloads">
      <div data-kodety-access-branch="content">
        <a href="/files/course.zip" data-kodety-protected-download>Baixar curso</a>
      </div>
      <div data-kodety-access-branch="guest">Entre</div>
      <div data-kodety-access-branch="upgrade">Upgrade</div>
    </section>
  </body></html>`;
  const downloadProject = {
    ...projectWithHtml(downloadSource),
    files: {
      ...projectWithHtml(downloadSource).files,
      'files/course.zip': {
        path: 'files/course.zip',
        mimeType: 'application/zip',
        data: downloadBytes,
      },
    },
  };
  const downloadMetadata = {
    projectId: 'project-download',
    membership: {
      version: 1,
      enabled: true,
      gates: { downloads: gate('downloads') },
      pages: {},
    },
  };
  const downloadCompiled = transport.prepareMembershipProjectForTransport(
    downloadProject,
    downloadMetadata,
  );
  assert.equal(
    downloadCompiled.files['files/course.zip'],
    undefined,
    'a protected source file must be removed from the public project tree',
  );
  const downloadRuntime = JSON.parse(
    downloadCompiled.files[transport.MEMBERSHIP_RUNTIME_PATH].text,
  );
  const [downloadAsset] = Object.values(downloadRuntime.assets);
  assert.ok(downloadAsset, 'a protected download must be recorded in the private manifest');
  assert.ok(
    downloadCompiled.files[downloadAsset.storagePath],
    'the protected bytes must move into opaque private storage',
  );
  assert.doesNotMatch(
    downloadCompiled.files['index.html'].text,
    /course\.zip|PRIVATE_DOWNLOAD_CANARY/,
    'the public HTML must not retain the protected filename or bytes',
  );
  assert.match(
    downloadRuntime.pages['index.html'].gates['downloads:1'].protectedHtml,
    /data-kodety-protected-asset="asset-[a-f0-9]{24}"/,
    'authorized HTML must carry only an opaque asset identifier',
  );
  const hydratedDownload = transport.hydrateMembershipProject(downloadCompiled);
  assert.deepEqual(
    hydratedDownload.files['files/course.zip'].data,
    downloadBytes,
    'opening the private transport must restore protected binary bytes exactly',
  );
  assert.throws(
    () => transport.prepareMembershipProjectForTransport(
      {
        ...downloadProject,
        files: {
          ...downloadProject.files,
          'files/public-copy.zip': {
            path: 'files/public-copy.zip',
            mimeType: 'application/zip',
            data: downloadBytes,
          },
        },
      },
      downloadMetadata,
    ),
    /também existe publicamente/,
    'a byte-identical public copy must block protected publication',
  );

  const variantPrefix = '.incode/experiments/experiment-a/variant-b/project/';
  const variantProject = {
    ...downloadProject,
    files: {
      ...downloadProject.files,
      [`${variantPrefix}index.html`]: {
        path: `${variantPrefix}index.html`,
        mimeType: 'text/html',
        text: '<!doctype html><html><body>Variant without download link</body></html>',
      },
      [`${variantPrefix}files/course.zip`]: {
        path: `${variantPrefix}files/course.zip`,
        mimeType: 'application/zip',
        data: downloadBytes,
      },
    },
  };
  assert.throws(
    () => transport.prepareMembershipProjectForTransport(variantProject, downloadMetadata),
    /também existe publicamente/,
    'a stale A/B clone of protected bytes must be treated as future public content',
  );

  const variantPageCanary = 'PRIVATE_VARIANT_PAGE_CANARY_2a8e';
  const pageVariantProject = {
    ...projectWithHtml(pageSource),
    files: {
      ...projectWithHtml(pageSource).files,
      [`${variantPrefix}index.html`]: {
        path: `${variantPrefix}index.html`,
        mimeType: 'text/html',
        text: `<!doctype html><html><body>${variantPageCanary}</body></html>`,
      },
    },
  };
  const pageVariantCompiled = transport.prepareMembershipProjectForTransport(
    pageVariantProject,
    {
      projectId: 'project-page-variant',
      membership: {
        version: 1,
        enabled: true,
        gates: {},
        pages: { 'index.html': protectedRule() },
      },
    },
  );
  const pageVariantRuntime = JSON.parse(
    pageVariantCompiled.files[transport.MEMBERSHIP_RUNTIME_PATH].text,
  );
  assert.ok(
    pageVariantRuntime.pages['.kodety-experiments/experiment-a/variant-b/index.html'],
    'an A/B clone must inherit its authored page-level policy under the runtime path',
  );
  assert.equal(
    pageVariantCompiled.files[`${variantPrefix}index.html`].text.includes(variantPageCanary),
    false,
    'private A/B page content must be scrubbed from the materialized clone',
  );

  const inspectorSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlInspector.tsx'),
    'utf8',
  );
  const membershipRuleEditorSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlMembershipRuleEditor.tsx'),
    'utf8',
  );
  const projectEditorSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
    'utf8',
  );
  const leftSidebarSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlEditorLeftSidebar.tsx'),
    'utf8',
  );
  const topbarSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlEditorTopbar.tsx'),
    'utf8',
  );
  const editorShellSource = await readFile(
    path.join(root, 'Wordpress/kodety/templates/editor-shell.php'),
    'utf8',
  );
  const membersPhpSource = await readFile(
    path.join(root, 'Wordpress/kodety/includes/class-kodety-members.php'),
    'utf8',
  );
  const membershipThemeSource = await readFile(
    path.join(root, 'Wordpress/kodety/theme-runtime/membership.php'),
    'utf8',
  );
  assert.match(
    editorShellSource,
    /'projectId'\s*=>\s*\$sanitize_membership_project_key\(\$request_project_metadata\['workspaceProjectId'\] \?\? ''\)/,
    'the Builder shell must expose its current workspace identity independently of the Membership extension',
  );
  assert.match(
    editorShellSource,
    /kodety_workspace_project_id[\s\S]*?kodety_published_project_id[\s\S]*?'membershipProjectEnabled'\s*=>\s*\$membership_extension_active\s*&&\s*\$membership_project_id !== ''\s*&&\s*Kodety_Members::is_project_enabled\(\$membership_project_id\)/,
    'membership opt-in must retain its guarded workspace identity and published fallback',
  );
  assert.match(
    membersPhpSource,
    /function is_current_project_enabled\(\): bool \{[\s\S]*?kodety_workspace_project_id[\s\S]*?if \(\$project_key === ''\)[\s\S]*?kodety_published_project_id[\s\S]*?return self::is_project_enabled\(\$project_key\)/,
    'WordPress navigation must resolve the active workspace project before its published fallback',
  );
  assert.match(
    membersPhpSource,
    /function admin_menu\(\): void \{[\s\S]*?if \(!self::is_current_project_enabled\(\)\) return;[\s\S]*?add_menu_page\([\s\S]*?'Membros'/,
    'the WordPress Members sidebar item must only be registered for an enabled current project',
  );
  assert.match(
    projectEditorSource,
    /synchronizeMembershipOptIn[\s\S]*?loadOverview\(controller\.signal\)[\s\S]*?settings\.enabled === overview\.enabled[\s\S]*?membership: \{ \.\.\.settings, enabled: overview\.enabled \}/,
    'Builder startup must reconcile membership metadata from the server-owned per-project opt-in',
  );
  const membershipActivationStart = projectEditorSource.indexOf(
    'const setProjectMembershipEnabled = useCallback(',
  );
  const membershipActivationEnd = projectEditorSource.indexOf(
    'const updateCurrentPageLocks =',
    membershipActivationStart,
  );
  assert.ok(
    membershipActivationStart >= 0 && membershipActivationEnd > membershipActivationStart,
    'the project membership activation callback must remain discoverable',
  );
  const membershipActivationSource = projectEditorSource.slice(
    membershipActivationStart,
    membershipActivationEnd,
  );
  const membershipServerUpdate = membershipActivationSource.indexOf(
    'createHtmlMembershipClient(membershipApi).setEnabled(enabled)',
  );
  const membershipServerConfirmation = membershipActivationSource.indexOf(
    'overview.enabled !== enabled',
  );
  const membershipDraftPersist = membershipActivationSource.indexOf(
    'persistExactWordPressDraft(next, true)',
  );
  const membershipLocalCommit = membershipActivationSource.indexOf('commitProject(next)');
  assert.ok(
    membershipServerUpdate >= 0
      && membershipServerConfirmation > membershipServerUpdate
      && membershipDraftPersist > membershipServerConfirmation
      && membershipLocalCommit > membershipDraftPersist,
    'membership activation must update WordPress first and then persist the confirmed Builder contract',
  );
  const inspectorDesignStart = inspectorSource.indexOf('<TabsContent value="design"');
  const inspectorSettingsStart = inspectorSource.indexOf(
    '<TabsContent\n          ref={settingsScrollRef}\n          value="settings"',
  );
  const inspectorInteractionsStart = inspectorSource.indexOf(
    '<TabsContent value="interactions"',
    inspectorSettingsStart,
  );
  assert.ok(
    inspectorDesignStart >= 0
      && inspectorSettingsStart > inspectorDesignStart
      && inspectorInteractionsStart > inspectorSettingsStart,
    'the inspector tabs must remain discoverable for Membership placement checks',
  );
  assert.equal(
    inspectorSource.slice(inspectorDesignStart, inspectorSettingsStart).includes('{membershipControls}'),
    false,
    'Membership controls must not expand the Design tab above Fluid Responsive',
  );
  assert.equal(
    inspectorSource.slice(inspectorSettingsStart, inspectorInteractionsStart).includes('{membershipControls}'),
    true,
    'Membership controls must live in the inspector Settings tab',
  );
  assert.ok(
    inspectorSource.includes("if (membershipFocusKey) setActiveTab('settings')")
      && inspectorSource.includes('}, [membershipFocusKey]);'),
    'selecting a gate or protected download must focus the Settings tab',
  );
  assert.equal(
    membershipRuleEditorSource.includes(
      'sm:grid-cols-[minmax(0,1fr)_minmax(160px,0.9fr)]',
    ),
    false,
    'fallback controls must not use viewport breakpoints inside the narrow inspector',
  );
  assert.ok(
    membershipRuleEditorSource.includes("compact ? (")
      && membershipRuleEditorSource.includes('<SelectItem key={option.value} value={option.value}>'),
    'the compact Membership editor must use one access selector instead of tall option cards',
  );
  const sidebarRailStart = leftSidebarSource.indexOf('data-builder-sidebar-rail');
  const sidebarUtilityStart = leftSidebarSource.indexOf(
    'data-builder-sidebar-utility-group',
    sidebarRailStart,
  );
  const sidebarUtilityEnd = leftSidebarSource.indexOf('</aside>', sidebarUtilityStart);
  const settingsButtonStart = leftSidebarSource.indexOf(
    '<HtmlProjectSettingsRailLink',
    sidebarUtilityStart,
  );
  const membershipPreviewStart = leftSidebarSource.indexOf(
    'data-tooltip={`Visualizar como ${membershipPreviewLabel}`}',
    sidebarUtilityStart,
  );
  assert.ok(
    sidebarRailStart >= 0
      && sidebarUtilityStart > sidebarRailStart
      && sidebarUtilityEnd > sidebarUtilityStart
      && membershipPreviewStart > sidebarUtilityStart
      && settingsButtonStart > membershipPreviewStart
      && sidebarUtilityEnd > settingsButtonStart,
    'the Membership preview must be an icon beside Settings in the bottom sidebar utility group',
  );
  assert.doesNotMatch(
    `${projectEditorSource}\n${topbarSource}`,
    /aria-label=\{`Visualizar como \$\{membershipPreviewLabel\}`\}/,
    'the Membership preview must not remain in the topbar',
  );
  assert.ok(
    leftSidebarSource.slice(membershipPreviewStart - 700, membershipPreviewStart)
      .includes('membershipExtensionActive && membershipEnabled'),
    'the Membership preview icon must render only for enabled Membership projects',
  );
  assert.equal(
    leftSidebarSource.slice(membershipPreviewStart, membershipPreviewStart + 500)
      .includes('{membershipPreviewLabel}</span>'),
    false,
    'the Membership preview trigger must stay icon-only',
  );
  assert.ok(
    leftSidebarSource.slice(membershipPreviewStart, membershipPreviewStart + 500)
      .includes('<Eye />'),
    'the Membership preview trigger must use an eye instead of the Membership people icon',
  );
  assert.match(
    projectEditorSource,
    /commitMembershipAudienceOverride[\s\S]*?updateMembershipAudienceElementOverride[\s\S]*?membershipPreviewLayer !== 'base'/,
    'visual edits outside Base must persist into the selected audience layer',
  );
  assert.match(
    membershipRuleEditorSource,
    /Base edita todos[\s\S]*?previewLayer: 'base'[\s\S]*?previewLayer: 'guest'[\s\S]*?previewLayer: 'member'/,
    'the selector must clearly separate Base, Visitante and Membro authoring layers',
  );
  assert.match(
    membershipThemeSource,
    /kodety_membership_current_audience_layers[\s\S]*?resolve_claims[\s\S]*?plan:[\s\S]*?kodety_membership_apply_audience_overrides/,
    'the published runtime must resolve real member plans before applying audience layers',
  );
  const sidebarPrimaryRail = leftSidebarSource.slice(sidebarRailStart, sidebarUtilityStart);
  const membershipExtensionGuard = sidebarPrimaryRail.indexOf('membershipExtensionActive &&');
  const membershipCapabilityGuard = sidebarPrimaryRail.indexOf(
    'topbarWp?.canViewMembers &&',
    membershipExtensionGuard,
  );
  const membershipUrlGuard = sidebarPrimaryRail.indexOf(
    'topbarWp.membersUrl ? (',
    membershipCapabilityGuard,
  );
  const membershipRailDestination = sidebarPrimaryRail.indexOf(
    'aria-label="Membership"',
    membershipUrlGuard,
  );
  assert.ok(
    membershipExtensionGuard >= 0
      && membershipCapabilityGuard > membershipExtensionGuard
      && membershipUrlGuard > membershipCapabilityGuard
      && membershipRailDestination > membershipUrlGuard,
    'the Builder Membership destination must live in the sidebar rail and appear only while its extension is active',
  );

  console.log('Membership domain and private transport tests passed.');
} finally {
  await server.close();
}
