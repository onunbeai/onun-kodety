import { expect, test } from '@playwright/test';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  diagnosticFingerprint,
  redactDiagnostic,
  redactedUrl,
  serializeRedactedArtifact,
} from './performance-artifact-redaction.mjs';
import {
  createFixtureFingerprintContract,
  verifyInstalledFixtureFingerprint,
} from './wordpress-installed-fixture.mjs';

const ARTIFACT_ROOT = path.resolve('artifacts/kodety-hardening/front-06/e2e');
const DEFAULT_LOADING_TIMEOUT_MS = 60_000;
const DEFAULT_AUTOSAVE_TIMEOUT_MS = 90_000;
const MAX_DIAGNOSTIC_LENGTH = 2_000;
const MAX_MONITOR_FAILURES = 100;
const monitors = new Map();

function requiredEnvironment(name) {
  const value = process.env[name]?.trim() || '';
  if (!value) throw new Error(`Defina ${name} para executar o smoke instalado.`);
  return value;
}

function boundedMilliseconds(name, fallback, minimum = 1_000, maximum = 10 * 60_000) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} deve ser um inteiro entre ${minimum} e ${maximum}.`);
  }
  return value;
}

function sameOriginUrl(siteBase, environmentName, fallbackPath) {
  const configured = process.env[environmentName]?.trim() || fallbackPath;
  const resolved = new URL(configured.replace(/^\/(?!\/)/, ''), siteBase);
  if (!['http:', 'https:'].includes(resolved.protocol)) {
    throw new Error(`${environmentName} deve usar HTTP(S).`);
  }
  if (resolved.origin !== siteBase.origin) {
    throw new Error(`${environmentName} deve permanecer na mesma origem de KODETY_E2E_BASE_URL.`);
  }
  resolved.username = '';
  resolved.password = '';
  return resolved.href;
}

function loadInstalledEnvironment() {
  const baseValue = requiredEnvironment('KODETY_E2E_BASE_URL');
  const siteBase = new URL(baseValue.endsWith('/') ? baseValue : `${baseValue}/`);
  if (!['http:', 'https:'].includes(siteBase.protocol) || siteBase.username || siteBase.password) {
    throw new Error('KODETY_E2E_BASE_URL deve ser uma URL HTTP(S) sem credenciais embutidas.');
  }

  const profile = (process.env.KODETY_E2E_PROJECT_PROFILE || 'small').trim().toLowerCase();
  if (!['small', 'large', 'legacy'].includes(profile)) {
    throw new Error('KODETY_E2E_PROJECT_PROFILE deve ser small, large ou legacy.');
  }
  const profileBuilderVariable = {
    small: 'KODETY_E2E_SMALL_BUILDER_URL',
    large: 'KODETY_E2E_LARGE_BUILDER_URL',
    legacy: 'KODETY_E2E_LEGACY_BUILDER_URL',
  }[profile];
  const genericBuilderUrl = process.env.KODETY_E2E_BUILDER_URL?.trim();
  const profileBuilderUrl = process.env[profileBuilderVariable]?.trim();
  if (profile !== 'small' && !profileBuilderUrl && !genericBuilderUrl) {
    throw new Error(
      `O perfil ${profile} exige ${profileBuilderVariable} ou KODETY_E2E_BUILDER_URL apontando para a fixture já instalada.`,
    );
  }
  const fixtureContract = createFixtureFingerprintContract({
    profile,
    siteBase,
    smallFingerprint: requiredEnvironment('KODETY_E2E_SMALL_PROJECT_FINGERPRINT'),
    largeFingerprint: requiredEnvironment('KODETY_E2E_LARGE_PROJECT_FINGERPRINT'),
    legacyFingerprint: requiredEnvironment('KODETY_E2E_LEGACY_PROJECT_FINGERPRINT'),
    receiptUrl: requiredEnvironment('KODETY_E2E_INSTALLED_FINGERPRINT_URL'),
  });
  const styleProperty = requiredEnvironment('KODETY_E2E_STYLE_PROPERTY');
  if (!/^(?:--[a-z0-9_-]+|[a-z][a-z0-9-]{0,63})$/i.test(styleProperty)) {
    throw new Error('KODETY_E2E_STYLE_PROPERTY deve ser uma propriedade CSS canônica.');
  }
  const publicationRequired = process.env.KODETY_E2E_REQUIRE_PUBLISH === '1';
  if (publicationRequired && process.env.KODETY_E2E_ALLOW_PUBLISH !== '1') {
    throw new Error(
      'O gate de release exige KODETY_E2E_ALLOW_PUBLISH=1; a autorização nunca é presumida.',
    );
  }

  return {
    siteBase,
    profile,
    fixture: process.env.KODETY_E2E_PROJECT_FIXTURE?.trim() || '',
    username: requiredEnvironment('KODETY_E2E_USER'),
    password: requiredEnvironment('KODETY_E2E_PASSWORD'),
    styleControlSelector: requiredEnvironment('KODETY_E2E_STYLE_CONTROL_SELECTOR'),
    styleProperty,
    styleValue: requiredEnvironment('KODETY_E2E_STYLE_VALUE'),
    styleExpectedComputedValue: requiredEnvironment('KODETY_E2E_STYLE_EXPECTED_COMPUTED_VALUE'),
    publicationRequired,
    ...fixtureContract,
    loginUrl: sameOriginUrl(siteBase, 'KODETY_E2E_LOGIN_URL', 'wp-login.php'),
    builderUrl: sameOriginUrl(
      siteBase,
      profileBuilderVariable,
      profileBuilderUrl || genericBuilderUrl || 'kodety/editor/',
    ),
    publishedUrl: sameOriginUrl(
      siteBase,
      'KODETY_E2E_PUBLISHED_URL',
      process.env.KODETY_E2E_PUBLISHED_URL?.trim() || siteBase.href,
    ),
    loadingTimeoutMs: boundedMilliseconds(
      'KODETY_E2E_LOADING_TIMEOUT_MS',
      DEFAULT_LOADING_TIMEOUT_MS,
    ),
    autosaveTimeoutMs: boundedMilliseconds(
      'KODETY_E2E_AUTOSAVE_TIMEOUT_MS',
      DEFAULT_AUTOSAVE_TIMEOUT_MS,
    ),
  };
}

function compileAllowlist(name) {
  const raw = process.env[name]?.trim();
  if (!raw) return [];
  let entries;
  if (raw.startsWith('[')) {
    try {
      entries = JSON.parse(raw);
    } catch {
      throw new Error(`${name} deve ser um array JSON de expressões regulares.`);
    }
  } else {
    entries = raw.split(/\r?\n/);
  }
  if (!Array.isArray(entries) || entries.some(entry => typeof entry !== 'string')) {
    throw new Error(`${name} deve conter apenas expressões regulares em texto.`);
  }
  return entries.filter(Boolean).map(pattern => new RegExp(pattern, 'i'));
}

function allowed(value, patterns) {
  return patterns.some(pattern => pattern.test(value));
}

function createBrowserMonitor(page, testInfo, artifactSuffix = '') {
  const consoleAllowlist = compileAllowlist('KODETY_E2E_CONSOLE_ERROR_ALLOWLIST');
  const httpAllowlist = compileAllowlist('KODETY_E2E_HTTP_ERROR_ALLOWLIST');
  const diagnosticSecrets = [
    process.env.KODETY_E2E_USER?.trim(),
    process.env.KODETY_E2E_PASSWORD?.trim(),
  ].filter(Boolean);
  const failures = [];
  const entries = [];
  const requestEntries = new WeakMap();
  const maximumEntries = 2_000;
  let droppedFailures = 0;

  const addFailure = (label, rawValue, allowlist) => {
    const value = redactDiagnostic(rawValue, diagnosticSecrets, MAX_DIAGNOSTIC_LENGTH);
    if (allowed(value, allowlist)) return;
    const fingerprint = diagnosticFingerprint(rawValue, diagnosticSecrets);
    const technical = `${fingerprint.category}:${fingerprint.sizeBytes}:sha256:${fingerprint.sha256}`;
    if (failures.length < MAX_MONITOR_FAILURES - 1) {
      failures.push(`${label}: ${technical}`);
      return;
    }
    droppedFailures += 1;
    failures[MAX_MONITOR_FAILURES - 1] = `monitor: ${droppedFailures} falha(s) adicional(is) omitida(s)`;
  };

  const onConsole = message => {
    if (message.type() !== 'error') return;
    addFailure('console.error', message.text(), consoleAllowlist);
  };
  const onRequest = request => {
    if (entries.length >= maximumEntries) return;
    const startedAt = new Date();
    const entry = {
      startedDateTime: startedAt.toISOString(),
      time: 0,
      request: {
        method: request.method(),
        url: redactedUrl(request.url()),
        httpVersion: '',
        headers: [],
        queryString: [],
        cookies: [],
        headersSize: -1,
        bodySize: -1,
      },
      response: {
        status: 0,
        statusText: '',
        httpVersion: '',
        headers: [],
        cookies: [],
        content: { size: 0, mimeType: '' },
        redirectURL: '',
        headersSize: -1,
        bodySize: -1,
      },
      cache: {},
      timings: { send: 0, wait: -1, receive: 0 },
      _startedAt: startedAt.getTime(),
    };
    entries.push(entry);
    requestEntries.set(request, entry);
  };
  const onResponse = response => {
    const request = response.request();
    const entry = requestEntries.get(request);
    if (entry) {
      entry.time = Math.max(0, Date.now() - entry._startedAt);
      entry.response.status = response.status();
      entry.response.statusText = redactDiagnostic(
        response.statusText(),
        diagnosticSecrets,
        MAX_DIAGNOSTIC_LENGTH,
      );
      delete entry._startedAt;
    }
    if (response.status() < 400) return;
    const value = `${response.status()} ${redactedUrl(response.url())}`;
    addFailure('HTTP inesperado', value, httpAllowlist);
  };
  const onRequestFailed = request => {
    const failure = request.failure()?.errorText || 'falha de rede';
    // Navegar entre workspaces cancela legitimamente fetches/recursos da página
    // anterior. Surface, projeto, delta e chunks são críticos mesmo quando o
    // Chromium os classifica como ERR_ABORTED.
    const criticalRequest = (() => {
      try {
        const url = new URL(request.url());
        const route = `${url.pathname}${url.searchParams.get('rest_route') || ''}`;
        return /(?:\/wp-json)?\/kodety\/v1\/project(?:\/surface(?:\/asset)?|\/chunk|\/delta)?\/?$/i
          .test(route)
          || (
            ['script', 'stylesheet'].includes(request.resourceType())
            && /\.(?:js|css)$/i.test(url.pathname)
          )
          || url.searchParams.get('action') === 'kodety_download_editor_project';
      } catch {
        return false;
      }
    })();
    if (/net::ERR_ABORTED/i.test(failure) && !criticalRequest) return;
    const value = `${failure} ${redactedUrl(request.url())}`;
    addFailure('requestfailed', value, httpAllowlist);
  };

  page.on('console', onConsole);
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);

  return {
    failures,
    async writeFailureHar() {
      await mkdir(ARTIFACT_ROOT, { recursive: true });
      const safeTitle = testInfo.title
        .replace(/[^a-z0-9_-]+/gi, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase()
        .slice(0, 120);
      const safeSuffix = artifactSuffix
        .replace(/[^a-z0-9_-]+/gi, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();
      const outputPath = path.join(
        ARTIFACT_ROOT,
        `${safeTitle || 'wordpress-installed-smoke'}${safeSuffix ? `-${safeSuffix}` : ''}.har`,
      );
      const har = {
        log: {
          version: '1.2',
          creator: { name: 'kodety-wordpress-installed-smoke', version: '1' },
          pages: [],
          entries: entries.map(({ _startedAt, ...entry }) => entry),
        },
      };
      const source = serializeRedactedArtifact(har, {
        redact: diagnosticSecrets,
        forbid: [process.env.KODETY_E2E_PASSWORD?.trim()].filter(Boolean),
      });
      const temporaryPath = `${outputPath}.${process.pid}.${testInfo.retry}.tmp`;
      try {
        await writeFile(temporaryPath, source, {
          encoding: 'utf8',
          flag: 'w',
          mode: 0o600,
        });
        await rename(temporaryPath, outputPath);
      } finally {
        await rm(temporaryPath, { force: true });
      }
    },
    dispose() {
      page.off('console', onConsole);
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
    },
  };
}

async function expectSuccessfulNavigation(page, url, label) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  expect(response, `${label} deve responder à navegação real`).not.toBeNull();
  expect(response.status(), `${label} respondeu com ${response.status()}`).toBeLessThan(400);
  expect(new URL(page.url()).origin, `${label} não pode redirecionar para outra origem`)
    .toBe(new URL(url).origin);
}

function assertSameOrigin(rawUrl, siteBase, label) {
  const resolved = new URL(rawUrl, siteBase);
  if (resolved.origin !== siteBase.origin) {
    throw new Error(`${label} saiu da origem autorizada ${siteBase.origin}.`);
  }
  return resolved;
}

async function blockCrossOriginWrites(context, siteBase) {
  const blocked = [];
  await context.route('**/*', async route => {
    const request = route.request();
    const method = request.method().toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const destination = new URL(request.url());
      if (destination.origin !== siteBase.origin) {
        blocked.push(`${method} ${redactedUrl(destination.href)}`);
        await route.abort('blockedbyclient');
        return;
      }
    }
    await route.continue();
  });
  return blocked;
}

async function login(page, environment) {
  await expectSuccessfulNavigation(page, environment.loginUrl, 'Login WordPress');
  assertSameOrigin(page.url(), environment.siteBase, 'Redirect do login');
  const username = page.locator('#user_login, input[name="log"], input[name="username"]').first();
  const password = page.locator('#user_pass, input[name="pwd"], input[type="password"]').first();
  await expect(username, 'Campo de usuário do login real').toBeVisible();
  await expect(password, 'Campo de senha do login real').toBeVisible();
  const formAction = await username.evaluate(element => element.form?.action || '');
  if (!formAction) throw new Error('O formulário de login não expõe uma action verificável.');
  assertSameOrigin(formAction, environment.siteBase, 'Action do formulário de login');
  await username.fill(environment.username);
  await password.fill(environment.password);
  const loginPageUrl = page.url();
  await Promise.all([
    page.waitForURL(
      url => url.origin === environment.siteBase.origin && url.href !== loginPageUrl,
      { waitUntil: 'domcontentloaded' },
    ),
    page.locator('#wp-submit, button[type="submit"], input[type="submit"]').first().click(),
  ]);
  assertSameOrigin(page.url(), environment.siteBase, 'Redirect após autenticação');
  await expect(
    page.locator('#user_login, input[name="log"], input[name="username"]').first(),
    'O WordPress permaneceu na tela de login; valide as credenciais/slug fornecidos.',
  ).toBeHidden();
  const authenticatedCookies = await page.context().cookies(environment.siteBase.href);
  expect(
    authenticatedCookies.some(cookie => cookie.name.startsWith('wordpress_logged_in_')),
    'Login real deve criar o cookie autenticado do WordPress.',
  ).toBe(true);
}

async function waitForWorkspaceReady(page, { name, readySelector }, timeout) {
  const ready = page.locator(readySelector).first();
  await expect(ready, `${name} deve renderizar sua superfície real`).toBeVisible({ timeout });
  await page.waitForFunction(() => {
    const selectors = '.kodety-boot-loader, [data-kodety-loading-screen]';
    return [...document.querySelectorAll(selectors)].every(element => {
      if (element.getAttribute('aria-busy') === 'false') return true;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display === 'none'
        || style.visibility === 'hidden'
        || Number(style.opacity) === 0
        || rect.width === 0
        || rect.height === 0;
    });
  }, null, { timeout });
  await expect.poll(
    () => ready.evaluate(element => Boolean(
      element.querySelector('button, a, input, textarea, select, iframe, main, section, [role="main"]')
      || element.textContent?.trim(),
    )),
    { message: `${name} não saiu do estado vazio/loading`, timeout },
  ).toBe(true);
}

async function firstVisibleLocator(scope, selector, label, timeout) {
  const candidates = scope.locator(selector);
  let visibleIndex = -1;
  await expect.poll(async () => {
    visibleIndex = -1;
    const count = Math.min(await candidates.count(), 250);
    for (let index = 0; index < count; index += 1) {
      if (await candidates.nth(index).isVisible()) {
        visibleIndex = index;
        break;
      }
    }
    return visibleIndex;
  }, { message: `${label} deve ter um candidato visível`, timeout }).toBeGreaterThanOrEqual(0);
  return candidates.nth(visibleIndex);
}

async function editorFrame(page, timeout) {
  const configured = process.env.KODETY_E2E_CANVAS_SELECTOR?.trim();
  const selector = configured || [
    'iframe[title="Canvas persistente da página HTML"]',
    '[data-infinite-canvas-active-iframe] iframe',
    'iframe[title$="— editável"]',
  ].join(', ');
  return firstVisibleLocator(page, selector, 'Canvas editável do Builder', timeout);
}

async function editTextInsideCanvas(page, marker, timeout) {
  const iframe = await editorFrame(page, timeout);
  await expect(iframe, 'Canvas editável do Builder').toBeVisible({ timeout });
  const frame = iframe.contentFrame();
  const configuredTarget = process.env.KODETY_E2E_TEXT_SELECTOR?.trim();
  const targetSelector = configuredTarget || 'h1, p';
  const target = await firstVisibleLocator(frame, targetSelector, `Alvo de texto ${targetSelector}`, timeout);
  await expect(target, `Alvo de texto ${targetSelector}`).toBeVisible({ timeout });
  await target.dblclick();
  const inlineEditor = frame.locator('[data-html-editor-editing]').first();
  if (await inlineEditor.isVisible().catch(() => false)) {
    await inlineEditor.press('ControlOrMeta+A');
    await inlineEditor.pressSequentially(marker);
    await inlineEditor.press('Enter');
  } else {
    // Compatibilidade para fixtures legadas sem os marcadores de edição. O
    // InputEvent ainda precisa atravessar a ponte; sem ACK o teste falhará.
    await target.evaluate((element, text) => {
      element.focus();
      element.textContent = text;
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        data: text,
        inputType: 'insertText',
      }));
      element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      element.blur();
    }, marker);
  }
  await expect(target).toContainText(marker);
  return targetSelector;
}

async function waitForAutosaveAcknowledgement(page, timeout) {
  const response = await page.waitForResponse(async candidate => {
    const request = candidate.request();
    if (!['POST', 'PUT', 'PATCH'].includes(request.method())) return false;
    const pathname = new URL(candidate.url()).pathname;
    if (!/(?:\/wp-json\/kodety\/v1\/project(?:\/delta|\/chunk)?|\/wp-admin\/admin-post\.php)\/?$/i.test(pathname)) {
      return false;
    }
    if (!candidate.ok()) return false;
    const payload = await candidate.json().catch(() => null);
    const revision = Number(payload?.workspaceRevision ?? payload?.data?.workspaceRevision);
    return payload?.success === true && Number.isSafeInteger(revision) && revision > 0;
  }, { timeout });
  const payload = await response.json();
  const revision = Number(payload.workspaceRevision ?? payload.data?.workspaceRevision);
  expect(Number.isSafeInteger(revision) && revision > 0, 'Autosave deve confirmar workspaceRevision').toBe(true);
  return revision;
}

async function expectPersistedMarker(page, selector, marker, timeout) {
  const iframe = await editorFrame(page, timeout);
  await expect(iframe).toBeVisible({ timeout });
  const target = await firstVisibleLocator(
    iframe.contentFrame(),
    selector,
    'Conteúdo salvo depois do reload',
    timeout,
  );
  await expect(target, 'Conteúdo salvo deve reaparecer depois do reload').toContainText(marker, { timeout });
}

async function editStyleThroughInspector(page, targetSelector, environment) {
  const iframe = await editorFrame(page, environment.loadingTimeoutMs);
  const target = await firstVisibleLocator(
    iframe.contentFrame(),
    targetSelector,
    'Alvo da edição de estilo',
    environment.loadingTimeoutMs,
  );
  await target.click();
  const control = await firstVisibleLocator(
    page,
    environment.styleControlSelector,
    `Controle de estilo ${environment.styleControlSelector}`,
    environment.loadingTimeoutMs,
  );
  const supported = await page.evaluate(
    ({ property, value }) => CSS.supports(property, value),
    { property: environment.styleProperty, value: environment.styleValue },
  );
  expect(supported, 'A fixture deve fornecer um par propriedade/valor CSS válido').toBe(true);
  await control.fill(environment.styleValue);
  await control.press('Tab');
  await expect.poll(
    () => target.evaluate((element, property) => (
      getComputedStyle(element).getPropertyValue(property).trim()
    ), environment.styleProperty),
    {
      message: `O Inspector deve aplicar ${environment.styleProperty}`,
      timeout: environment.loadingTimeoutMs,
    },
  ).toBe(environment.styleExpectedComputedValue);
}

async function expectPersistedStyle(page, targetSelector, environment) {
  const iframe = await editorFrame(page, environment.loadingTimeoutMs);
  const target = await firstVisibleLocator(
    iframe.contentFrame(),
    targetSelector,
    'Alvo do estilo salvo depois do reload',
    environment.loadingTimeoutMs,
  );
  await expect.poll(
    () => target.evaluate((element, property) => (
      getComputedStyle(element).getPropertyValue(property).trim()
    ), environment.styleProperty),
    {
      message: `O estilo ${environment.styleProperty} deve persistir depois do reload`,
      timeout: environment.loadingTimeoutMs,
    },
  ).toBe(environment.styleExpectedComputedValue);
}

async function validatePublishedPageAnonymously(page, environment, marker, testInfo) {
  const browser = page.context().browser();
  if (!browser) throw new Error('A validação pública exige um browser com contexto isolável.');
  const expectedUrl = new URL(environment.publishedUrl);
  if (/\/(?:wp-admin(?:\/|$)|wp-login\.php(?:\/|$))/i.test(expectedUrl.pathname)) {
    throw new Error('KODETY_E2E_PUBLISHED_URL não pode apontar para login/admin.');
  }
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const anonymousPage = await context.newPage();
  const monitor = createBrowserMonitor(anonymousPage, testInfo, 'published-anonymous');
  try {
    const beforeCookies = await context.cookies(environment.siteBase.href);
    expect(
      beforeCookies.some(cookie => cookie.name.startsWith('wordpress_logged_in_')),
      'A validação pública deve começar sem cookie autenticado.',
    ).toBe(false);
    const blockedWrites = await blockCrossOriginWrites(context, environment.siteBase);
    const response = await anonymousPage.goto(environment.publishedUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Página publicada anônima deve responder').not.toBeNull();
    expect(response.status(), 'Página publicada anônima deve responder sem erro').toBeLessThan(400);
    assertSameOrigin(anonymousPage.url(), environment.siteBase, 'Redirect da página publicada');
    const finalUrl = new URL(anonymousPage.url());
    expect(
      /\/(?:wp-admin(?:\/|$)|wp-login\.php(?:\/|$))/i.test(finalUrl.pathname),
      'A página pública anônima não pode redirecionar para login/admin.',
    ).toBe(false);
    const afterCookies = await context.cookies(environment.siteBase.href);
    expect(
      afterCookies.some(cookie => cookie.name.startsWith('wordpress_logged_in_')),
      'A validação pública não pode adquirir cookie autenticado.',
    ).toBe(false);
    expect(blockedWrites, 'A página pública não pode tentar escrita cross-origin').toEqual([]);
    await expect(anonymousPage.locator('body')).toContainText(marker, {
      timeout: environment.loadingTimeoutMs,
    });
    expect(monitor.failures, 'Console, HTTP e rede da página pública devem permanecer limpos')
      .toEqual([]);
  } catch (error) {
    await monitor.writeFailureHar();
    throw error;
  } finally {
    monitor.dispose();
    await context.close();
  }
}

async function publishWhenExplicitlyAllowed(page, environment, marker, testInfo) {
  if (process.env.KODETY_E2E_ALLOW_PUBLISH !== '1') return;
  const publishSelector = process.env.KODETY_E2E_PUBLISH_SELECTOR?.trim();
  const publishButton = publishSelector
    ? page.locator(publishSelector).first()
    : page.getByRole('button', { name: /publicar|publish/i }).first();
  await expect(publishButton, 'A publicação foi autorizada, mas o controle não está disponível.').toBeVisible();
  const publishResponse = page.waitForResponse(async response => {
    if (response.request().method() !== 'POST') return false;
    if (!/\/wp-json\/kodety\/v1\/publish\/?$/i.test(new URL(response.url()).pathname)) return false;
    if (!response.ok()) return false;
    const payload = await response.json().catch(() => null);
    return payload?.success === true && Number.isSafeInteger(Number(payload.workspaceRevision));
  }, { timeout: environment.autosaveTimeoutMs });
  const publishTrigger = await publishButton.elementHandle();
  await publishButton.click();
  const confirmationCandidates = page.getByRole(
    'button',
    { name: /^(publicar|publish)( agora| now)?$/i },
  );
  let publicationSettled = false;
  const confirmationPromise = (async () => {
    const deadline = Date.now() + environment.autosaveTimeoutMs;
    while (!publicationSettled && Date.now() < deadline) {
      const count = await confirmationCandidates.count();
      for (let index = count - 1; index >= 0; index -= 1) {
        const candidate = confirmationCandidates.nth(index);
        if (
          await candidate.isVisible().catch(() => false)
          && !(await candidate.evaluate((node, first) => node === first, publishTrigger))
        ) {
          return candidate;
        }
      }
      await page.waitForTimeout(100);
    }
    return null;
  })();
  let firstOutcome;
  try {
    firstOutcome = await Promise.race([
      publishResponse.then(response => ({ kind: 'response', response })),
      confirmationPromise.then(confirmation => (
        confirmation
          ? { kind: 'confirmation', confirmation }
          : { kind: 'confirmation-timeout' }
      )),
    ]);
  } finally {
    publicationSettled = true;
  }
  if (firstOutcome.kind === 'confirmation-timeout') {
    throw new Error('Publicação não respondeu nem exibiu confirmação no prazo de segurança.');
  }
  if (firstOutcome.kind === 'confirmation') {
    await firstOutcome.confirmation.click();
  }
  const response = firstOutcome.kind === 'response'
    ? firstOutcome.response
    : await publishResponse;
  expect(response.status(), 'Publicação local deve responder com sucesso').toBeLessThan(400);
  await validatePublishedPageAnonymously(page, environment, marker, testInfo);
}

function lightWorkspaces(environment) {
  return [
    {
      name: 'Settings',
      url: sameOriginUrl(environment.siteBase, 'KODETY_E2E_SETTINGS_URL', 'kodety/settings/'),
      readySelector: 'main[data-kodety-light-workspace="settings"]',
    },
    {
      name: 'CMS',
      url: sameOriginUrl(environment.siteBase, 'KODETY_E2E_CMS_URL', 'kodety/cms/'),
      readySelector: 'main [data-workspace-topbar], main[data-kodety-read-only] [data-workspace-topbar]',
    },
    {
      name: 'Analytics',
      url: sameOriginUrl(environment.siteBase, 'KODETY_E2E_ANALYTICS_URL', 'kodety/analytics/'),
      readySelector: 'main[data-kodety-light-workspace="analytics"]',
    },
    {
      name: 'Localization',
      url: sameOriginUrl(environment.siteBase, 'KODETY_E2E_LOCALIZATION_URL', 'kodety/localization/'),
      readySelector: '[data-kodety-agent-surface="localization"]',
    },
    {
      name: 'Email',
      url: sameOriginUrl(environment.siteBase, 'KODETY_E2E_EMAIL_URL', 'wp-admin/admin.php?page=kodety-emails'),
      readySelector: '.wrap.kodety-emails',
    },
    {
      name: 'File System',
      url: sameOriginUrl(environment.siteBase, 'KODETY_E2E_FILE_SYSTEM_URL', 'kodety-files/'),
      readySelector: '#kodety-file-system-root',
    },
  ];
}

test.beforeEach(async ({ page }, testInfo) => {
  monitors.set(testInfo.testId, createBrowserMonitor(page, testInfo));
});

test.afterEach(async ({}, testInfo) => {
  const monitor = monitors.get(testInfo.testId);
  if (!monitor) return;
  const monitorFailures = [...new Set(monitor.failures)];
  if (testInfo.status !== testInfo.expectedStatus || monitorFailures.length > 0) {
    await monitor.writeFailureHar();
  }
  monitor.dispose();
  monitors.delete(testInfo.testId);
  expect(monitorFailures, 'Console, HTTP e rede devem permanecer limpos no smoke instalado').toEqual([]);
});

test('login, edição, autosave, reload, publicação opcional e workspaces instalados', async ({ page }, testInfo) => {
  const environment = loadInstalledEnvironment();
  const blockedCrossOriginWrites = await blockCrossOriginWrites(page.context(), environment.siteBase);
  testInfo.annotations.push({ type: 'project-profile', description: environment.profile });
  if (environment.fixture) {
    testInfo.annotations.push({ type: 'project-fixture', description: 'configured' });
  }

  await login(page, environment);
  const fixtureReceipt = await verifyInstalledFixtureFingerprint(
    page.context().request,
    environment,
  );
  testInfo.annotations.push({
    type: 'fixture-receipt',
    description: fixtureReceipt.source,
  });
  await expectSuccessfulNavigation(page, environment.builderUrl, `Builder ${environment.profile}`);
  await waitForWorkspaceReady(
    page,
    { name: 'Builder', readySelector: '[data-workspace-topbar]' },
    environment.loadingTimeoutMs,
  );

  const marker = `Kodety E2E ${environment.profile} ${Date.now()}`;
  const autosavePromise = waitForAutosaveAcknowledgement(page, environment.autosaveTimeoutMs);
  const targetSelector = await editTextInsideCanvas(page, marker, environment.loadingTimeoutMs);
  const savedRevision = await autosavePromise;
  testInfo.annotations.push({ type: 'autosave-revision', description: String(savedRevision) });
  const styleAutosavePromise = waitForAutosaveAcknowledgement(page, environment.autosaveTimeoutMs);
  await editStyleThroughInspector(page, targetSelector, environment);
  const styledRevision = await styleAutosavePromise;
  expect(styledRevision, 'A edição de estilo deve avançar workspaceRevision')
    .toBeGreaterThan(savedRevision);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForWorkspaceReady(
    page,
    { name: 'Builder após reload', readySelector: '[data-workspace-topbar]' },
    environment.loadingTimeoutMs,
  );
  await expectPersistedMarker(page, targetSelector, marker, environment.loadingTimeoutMs);
  await expectPersistedStyle(page, targetSelector, environment);
  await publishWhenExplicitlyAllowed(page, environment, marker, testInfo);

  for (const workspace of lightWorkspaces(environment)) {
    await expectSuccessfulNavigation(page, workspace.url, workspace.name);
    await waitForWorkspaceReady(page, workspace, environment.loadingTimeoutMs);
  }
  expect(blockedCrossOriginWrites, 'O smoke não pode tentar POST cross-origin').toEqual([]);
});
