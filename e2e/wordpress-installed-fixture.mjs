function requiredText(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`Defina ${name} para provar a fixture instalada.`);
  return normalized;
}

export function createFixtureFingerprintContract({
  profile,
  siteBase,
  smallFingerprint,
  largeFingerprint,
  legacyFingerprint,
  receiptUrl,
}) {
  const normalizedProfile = String(profile ?? '').trim().toLowerCase();
  if (!['small', 'large', 'legacy'].includes(normalizedProfile)) {
    throw new Error('O perfil da fixture deve ser small, large ou legacy.');
  }
  const fingerprints = {
    small: requiredText(smallFingerprint, 'KODETY_E2E_SMALL_PROJECT_FINGERPRINT').toLowerCase(),
    large: requiredText(largeFingerprint, 'KODETY_E2E_LARGE_PROJECT_FINGERPRINT').toLowerCase(),
    legacy: requiredText(legacyFingerprint, 'KODETY_E2E_LEGACY_PROJECT_FINGERPRINT').toLowerCase(),
  };
  if (!Object.values(fingerprints).every(value => /^[a-f0-9]{64}$/.test(value))) {
    throw new Error('Os fingerprints small/large devem ser SHA-256 hexadecimais.');
  }
  if (new Set(Object.values(fingerprints)).size !== Object.keys(fingerprints).length) {
    throw new Error('As fixtures small, large e legacy devem ter fingerprints distintos.');
  }
  const authorizedBase = siteBase instanceof URL ? siteBase : new URL(siteBase);
  const fingerprintReceiptUrl = new URL(
    requiredText(receiptUrl, 'KODETY_E2E_INSTALLED_FINGERPRINT_URL'),
    authorizedBase,
  );
  if (
    !['http:', 'https:'].includes(fingerprintReceiptUrl.protocol)
    || fingerprintReceiptUrl.origin !== authorizedBase.origin
    || fingerprintReceiptUrl.username
    || fingerprintReceiptUrl.password
  ) {
    throw new Error('O receipt da fixture deve usar HTTP(S), sem credenciais e na origem autorizada.');
  }
  fingerprintReceiptUrl.hash = '';
  return {
    expectedProjectFingerprint: fingerprints[normalizedProfile],
    fingerprintReceiptUrl: fingerprintReceiptUrl.href,
  };
}

export async function verifyInstalledFixtureFingerprint(requestContext, environment) {
  if (!requestContext || typeof requestContext.get !== 'function') {
    throw new Error('O receipt da fixture exige um contexto HTTP autenticado.');
  }
  const response = await requestContext.get(environment.fingerprintReceiptUrl, {
    failOnStatusCode: false,
    headers: { Accept: 'application/json' },
    maxRedirects: 0,
  });
  const responseUrl = new URL(response.url());
  if (responseUrl.origin !== environment.siteBase.origin) {
    throw new Error('O receipt da fixture saiu da origem autorizada.');
  }
  if (!response.ok()) {
    throw new Error(`O receipt autenticado da fixture respondeu HTTP ${response.status()}.`);
  }
  const contentType = response.headers()['content-type'] || '';
  if (!/\bapplication\/json\b/i.test(contentType)) {
    throw new Error('O receipt autenticado da fixture deve responder application/json.');
  }
  const payload = await response.json().catch(() => null);
  const fingerprint = String(
    payload?.fingerprint ?? payload?.data?.fingerprint ?? '',
  ).trim().toLowerCase();
  const profile = String(payload?.profile ?? payload?.data?.profile ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint) || !['small', 'large', 'legacy'].includes(profile)) {
    throw new Error('O receipt autenticado não expôs profile e fingerprint SHA-256 válidos.');
  }
  if (profile !== environment.profile) {
    throw new Error(`A instalação reportou a fixture ${profile}, mas o gate exige ${environment.profile}.`);
  }
  if (fingerprint !== environment.expectedProjectFingerprint) {
    throw new Error('O fingerprint lido da instalação não corresponde à fixture esperada.');
  }
  return { profile, fingerprint, source: 'authenticated-same-origin-receipt' };
}
