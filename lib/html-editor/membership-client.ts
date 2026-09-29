import {
  normalizeMembershipPlanKey,
  type MembershipEntitlement,
  type MembershipEntitlementStatus,
  type MembershipPlanOption,
} from './membership';

export type HtmlMembershipMemberStatus = 'active' | 'invited' | 'suspended';
export type HtmlMembershipPlanStatus = 'active' | 'draft' | 'archived';
export const HTML_MEMBERSHIP_COMMERCE_PROVIDERS = [
  'stripe',
  'mercado_pago',
  'asaas',
  'pagbank',
  'pagarme',
  'woovi',
  'iugu',
  'hotmart',
  'ticto',
] as const;
export type HtmlMembershipCommerceProvider =
  typeof HTML_MEMBERSHIP_COMMERCE_PROVIDERS[number];
export type HtmlMembershipCommerceEnvironment = 'production' | 'sandbox';
export type HtmlMembershipPurchaseMode = 'payment' | 'subscription';
export type HtmlMembershipCommerceConnectionStatus =
  | 'connected'
  | 'pending'
  | 'error'
  | 'expired'
  | 'disconnected';

export interface HtmlMembershipPlan extends MembershipPlanOption {
  id: string | number;
  key: string;
  name: string;
  description: string;
  status: HtmlMembershipPlanStatus;
  memberCount: number;
  upgradeUrl: string;
  provider: string;
  externalId: string;
  createdAt: string;
  updatedAt: string;
}

export interface HtmlMembershipMemberEntitlement extends MembershipEntitlement {
  id?: string | number;
  status: MembershipEntitlementStatus;
  source?: string;
}

export interface HtmlMembershipMember {
  id: string | number;
  email: string;
  displayName: string;
  avatarUrl: string;
  status: HtmlMembershipMemberStatus;
  registeredAt: string;
  lastLoginAt: string;
  entitlements: HtmlMembershipMemberEntitlement[];
  planKeys: string[];
}

export interface HtmlMembershipOverview {
  enabled: boolean;
  memberCount: number;
  activeMemberCount: number;
  planCount: number;
  capabilities: {
    manageMembers: boolean;
    createMembers: boolean;
    assignPlans: boolean;
    manageCommerce: boolean;
    managePlans: boolean;
    manageSettings: boolean;
  };
}

export interface HtmlMembershipCommerceOverview {
  providers: Array<{
    id: HtmlMembershipCommerceProvider;
    label: string;
    available: boolean;
    capabilities: string[];
  }>;
  connectionCount: number;
  activeConnectionCount: number;
  attentionConnectionCount: number;
  mappedPlanCount: number;
  saleCount: number;
  paidSaleCount: number;
  pendingSaleCount: number;
  refundedSaleCount: number;
  activeSubscriptionCount: number;
  trialingSubscriptionCount: number;
  pastDueSubscriptionCount: number;
  unlinkedSaleCount: number;
}

export interface HtmlMembershipCommerceConnection {
  id: string | number;
  provider: HtmlMembershipCommerceProvider;
  name: string;
  enabled: boolean;
  status: HtmlMembershipCommerceConnectionStatus;
  environment: HtmlMembershipCommerceEnvironment;
  accountId: string;
  accountName: string;
  credentialFields: string[];
  capabilities: {
    hostedCheckout: boolean;
    oneTime: boolean;
    subscriptions: boolean;
    customerPortal: boolean;
    products: boolean;
    oauth: boolean;
  };
  dashboardUrl: string;
  connectUrl: string;
  webhookUrl: string;
  errorMessage: string;
  lastVerifiedAt: string;
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveHtmlMembershipCommerceConnectionInput {
  provider: HtmlMembershipCommerceProvider;
  name: string;
  enabled: boolean;
  credentials?: Record<string, string>;
  settings?: {
    environment?: HtmlMembershipCommerceEnvironment;
    [key: string]: unknown;
  };
}

export interface HtmlMembershipCommerceProductPrice {
  id: string;
  name: string;
  active: boolean;
  mode: HtmlMembershipPurchaseMode;
  currency: string;
  amount: number | null;
  interval: string;
}

export interface HtmlMembershipCommerceProduct {
  id: string;
  name: string;
  description: string;
  active: boolean;
  mode: HtmlMembershipPurchaseMode;
  prices: HtmlMembershipCommerceProductPrice[];
}

export interface HtmlMembershipCommerceMapping {
  id: string | number;
  connectionId: string | number;
  planId: string | number;
  planKey: string;
  planName: string;
  provider: HtmlMembershipCommerceProvider;
  externalProductId: string;
  externalPriceId: string;
  mode: HtmlMembershipPurchaseMode;
  currency: string;
  amount: number | null;
  status: string;
  publicKey: string;
  publicUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveHtmlMembershipCommerceMappingInput {
  connectionId: string | number;
  planId: string | number;
  externalProductId?: string;
  externalPriceId?: string;
  mode: HtmlMembershipPurchaseMode;
  currency?: string;
  amount?: number | null;
}

export type UpdateHtmlMembershipCommerceMappingInput = Omit<
  SaveHtmlMembershipCommerceMappingInput,
  'connectionId' | 'planId' | 'mode'
> & {
  status?: 'active' | 'paused';
};

export interface HtmlMembershipCommerceRecord {
  id: string | number;
  provider: HtmlMembershipCommerceProvider;
  connectionId: string | number;
  externalId: string;
  externalCustomerId: string;
  externalContractId: string;
  status: string;
  accessStatus: string;
  environment: HtmlMembershipCommerceEnvironment;
  userId: string | number | null;
  customerName: string;
  customerEmail: string;
  planId: string | number | null;
  planKey: string;
  planName: string;
  currency: string;
  amount: number | null;
  dashboardUrl: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface HtmlMembershipCommerceSubscription extends HtmlMembershipCommerceRecord {
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt: string;
  canceledAt: string;
  endedAt: string;
  portalAvailable: boolean;
}

export interface HtmlMembershipCommercePage<T> {
  items: T[];
  total: number;
  totalPages: number;
  page: number;
}

export interface HtmlMembershipCommerceListRequest {
  page?: number;
  perPage?: number;
  search?: string;
  status?: string;
  provider?: '' | HtmlMembershipCommerceProvider;
  signal?: AbortSignal;
}

export interface CreateHtmlMembershipCheckoutLinkInput {
  connectionId: string | number;
  planId: string | number;
  userId?: string | number;
  mode: HtmlMembershipPurchaseMode;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  clientReference?: string;
}

export interface HtmlMembershipCheckoutLink {
  id: string | number;
  url: string;
  provider: HtmlMembershipCommerceProvider;
  expiresAt: string;
}

export interface HtmlMembershipEphemeralLink {
  url: string;
  expiresAt: string;
}

export interface HtmlMembershipCommerceSyncResult {
  checked: number;
  projected: number;
  ignored: number;
  failed: number;
  staleEventsRecovered: number;
  piiPurged: number;
}

export interface ChangeHtmlMembershipMemberAccessInput {
  planId: string | number;
  action: 'grant' | 'revoke' | 'restore';
  connectionId?: string | number;
  reason?: string;
}

export interface HtmlMembershipMemberAccessResult {
  access: 'granted' | 'revoked' | 'restored';
  billingUnaffected: boolean;
  requiresSync: boolean;
}

export interface HtmlMembershipRuntimeSettings {
  enabled: boolean;
  registrationEnabled: boolean;
  requireEmailVerification: boolean;
  enabledProjects: string[];
  defaultRole: string;
  auditRetentionDays: number;
  eventRetentionDays: number;
  loginPageUrl: string;
  accountPageUrl: string;
  upgradePageUrl: string;
  resetPageUrl: string;
  afterLoginUrl: string;
  afterLogoutUrl: string;
}

export interface HtmlMembershipMembersRequest {
  page?: number;
  perPage?: number;
  search?: string;
  status?: '' | HtmlMembershipMemberStatus;
  planKey?: string;
  signal?: AbortSignal;
}

export interface HtmlMembershipMembersPage {
  items: HtmlMembershipMember[];
  total: number;
  totalPages: number;
  page: number;
}

export interface CreateHtmlMembershipMemberInput {
  email: string;
  displayName?: string;
  password?: string;
  planKeys?: string[];
  sendInvite?: boolean;
}

export interface UpdateHtmlMembershipMemberInput {
  displayName?: string;
  status?: HtmlMembershipMemberStatus;
  planKeys?: string[];
}

export interface SaveHtmlMembershipPlanInput {
  key: string;
  name: string;
  description?: string;
  status?: HtmlMembershipPlanStatus;
  upgradeUrl?: string;
  provider?: string;
  externalId?: string;
}

export interface HtmlMembershipApiConfig {
  baseUrl?: string;
  /** Stable Builder project identity used to scope activation and overview. */
  projectId?: string;
  overviewUrl: string;
  usersUrl: string;
  /**
   * Optional endpoint template containing `{id}`. When omitted, the encoded ID
   * is appended to `usersUrl`.
   */
  userUrl?: string;
  plansUrl: string;
  /**
   * Optional endpoint template containing `{id}` or `{key}`. When omitted, the
   * encoded plan ID is appended to `plansUrl`.
   */
  planUrl?: string;
  settingsUrl: string;
  activationUrl?: string;
  /** Base of the private commerce API, e.g. `/kodety/v1/members/commerce`. */
  commerceBaseUrl?: string;
  nonce?: string;
  nonceHeader?: string;
  credentials?: RequestCredentials;
}

/**
 * Exact keys expected on `window.kodetyWordPress`. Keeping every membership URL
 * prefixed prevents collisions with the existing Builder settings/CMS routes.
 */
export interface HtmlMembershipWordPressConfig {
  projectId?: string;
  /** Server-owned per-project opt-in, exposed as an immediate render hint. */
  membershipProjectEnabled?: boolean;
  membersOverviewUrl?: string;
  membersUsersUrl?: string;
  membersUserUrl?: string;
  membersPlansUrl?: string;
  membersPlanUrl?: string;
  membersSettingsUrl?: string;
  membersActivationUrl?: string;
  membersCommerceUrl?: string;
  nonce?: string;
}

export interface HtmlMembershipDataSource {
  loadOverview: (signal?: AbortSignal) => Promise<HtmlMembershipOverview>;
  setEnabled: (enabled: boolean) => Promise<HtmlMembershipOverview>;
  loadMembers: (request?: HtmlMembershipMembersRequest) => Promise<HtmlMembershipMembersPage>;
  createMember: (input: CreateHtmlMembershipMemberInput) => Promise<HtmlMembershipMember>;
  updateMember: (
    id: string | number,
    input: UpdateHtmlMembershipMemberInput,
  ) => Promise<HtmlMembershipMember>;
  loadMember?: (id: string | number, signal?: AbortSignal) => Promise<HtmlMembershipMember>;
  deleteMember: (id: string | number) => Promise<void>;
  loadPlans: (signal?: AbortSignal) => Promise<HtmlMembershipPlan[]>;
  createPlan: (input: SaveHtmlMembershipPlanInput) => Promise<HtmlMembershipPlan>;
  updatePlan: (
    id: string | number,
    input: SaveHtmlMembershipPlanInput,
  ) => Promise<HtmlMembershipPlan>;
  deletePlan: (id: string | number) => Promise<void>;
  loadSettings: (signal?: AbortSignal) => Promise<HtmlMembershipRuntimeSettings>;
  saveSettings: (
    input: HtmlMembershipRuntimeSettings,
  ) => Promise<HtmlMembershipRuntimeSettings>;
  /** Commerce remains absent for legacy/custom hosts, preserving the membership opt-in boundary. */
  commerceAvailable?: boolean;
  loadCommerceOverview?: (signal?: AbortSignal) => Promise<HtmlMembershipCommerceOverview>;
  syncCommerce?: (limit?: number) => Promise<HtmlMembershipCommerceSyncResult>;
  loadCommerceConnections?: (signal?: AbortSignal) => Promise<HtmlMembershipCommerceConnection[]>;
  createCommerceConnection?: (
    input: SaveHtmlMembershipCommerceConnectionInput,
  ) => Promise<HtmlMembershipCommerceConnection>;
  updateCommerceConnection?: (
    id: string | number,
    input: SaveHtmlMembershipCommerceConnectionInput,
  ) => Promise<HtmlMembershipCommerceConnection>;
  deleteCommerceConnection?: (id: string | number) => Promise<void>;
  testCommerceConnection?: (
    id: string | number,
  ) => Promise<HtmlMembershipCommerceConnection>;
  loadCommerceProducts?: (
    connectionId: string | number,
    signal?: AbortSignal,
  ) => Promise<HtmlMembershipCommerceProduct[]>;
  loadCommerceMappings?: (signal?: AbortSignal) => Promise<HtmlMembershipCommerceMapping[]>;
  createCommerceMapping?: (
    input: SaveHtmlMembershipCommerceMappingInput,
  ) => Promise<HtmlMembershipCommerceMapping>;
  updateCommerceMapping?: (
    id: string | number,
    input: UpdateHtmlMembershipCommerceMappingInput,
  ) => Promise<HtmlMembershipCommerceMapping>;
  deleteCommerceMapping?: (id: string | number) => Promise<void>;
  createCheckoutLink?: (
    input: CreateHtmlMembershipCheckoutLinkInput,
  ) => Promise<HtmlMembershipCheckoutLink>;
  loadCommerceSales?: (
    request?: HtmlMembershipCommerceListRequest,
  ) => Promise<HtmlMembershipCommercePage<HtmlMembershipCommerceRecord>>;
  loadCommerceSubscriptions?: (
    request?: HtmlMembershipCommerceListRequest,
  ) => Promise<HtmlMembershipCommercePage<HtmlMembershipCommerceSubscription>>;
  createSubscriptionPortalLink?: (
    id: string | number,
  ) => Promise<HtmlMembershipEphemeralLink>;
  createMemberAccessLink?: (
    id: string | number,
  ) => Promise<HtmlMembershipEphemeralLink>;
  createMemberResetLink?: (
    id: string | number,
  ) => Promise<HtmlMembershipEphemeralLink>;
  sendMemberResetEmail?: (id: string | number) => Promise<void>;
  changeMemberAccess?: (
    id: string | number,
    input: ChangeHtmlMembershipMemberAccessInput,
  ) => Promise<HtmlMembershipMemberAccessResult>;
}

const DEFAULT_RUNTIME_SETTINGS: HtmlMembershipRuntimeSettings = {
  enabled: false,
  registrationEnabled: false,
  requireEmailVerification: false,
  enabledProjects: [],
  defaultRole: 'subscriber',
  auditRetentionDays: 730,
  eventRetentionDays: 365,
  loginPageUrl: '',
  accountPageUrl: '',
  upgradePageUrl: '',
  resetPageUrl: '',
  afterLoginUrl: '',
  afterLogoutUrl: '',
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function identifier(value: unknown): string | number | null {
  return typeof value === 'number' || typeof value === 'string' ? value : null;
}

function positiveIdentifier(value: unknown): string | number | null {
  const normalized = identifier(value);
  if (normalized === null || normalized === '' || Number(normalized) === 0) return null;
  return normalized;
}

function finiteNonNegative(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function booleanValue(value: unknown, fallback = false) {
  if (value === true || value === 1 || value === 'true') return true;
  if (value === false || value === 0 || value === 'false') return false;
  return fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function safeHttpUrl(value: unknown) {
  const candidate = text(value).trim();
  if (!candidate) return '';
  try {
    const parsed = new URL(
      candidate,
      typeof window === 'undefined' ? 'https://kodety.invalid/' : window.location.href,
    );
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    if (typeof window === 'undefined' && parsed.hostname === 'kodety.invalid') {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

export function normalizeHtmlMembershipCommerceProvider(
  value: unknown,
): HtmlMembershipCommerceProvider {
  const candidate = text(value).trim().toLocaleLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
  const aliases: Record<string, HtmlMembershipCommerceProvider> = {
    stripe: 'stripe',
    mercado_pago: 'mercado_pago',
    mercadopago: 'mercado_pago',
    asaas: 'asaas',
    pagbank: 'pagbank',
    pag_bank: 'pagbank',
    pagseguro: 'pagbank',
    pagarme: 'pagarme',
    pagar_me: 'pagarme',
    woovi: 'woovi',
    openpix: 'woovi',
    iugu: 'iugu',
    hotmart: 'hotmart',
    hot_mart: 'hotmart',
    ticto: 'ticto',
  };
  const provider = aliases[candidate];
  if (!provider) {
    throw new Error(`Provedor de checkout desconhecido: ${candidate || '(vazio)'}.`);
  }
  return provider;
}

export function htmlMembershipCommerceRequiresCustomerEmail(
  provider: HtmlMembershipCommerceProvider,
) {
  return provider === 'iugu' || provider === 'woovi';
}

/**
 * The current backend publishes a same-site landing URL for every mapping.
 * Guests enter and verify their e-mail there before the server creates a fresh
 * provider session. Only that landing contract is safe as an evergreen href.
 */
export function htmlMembershipCommerceSupportsAnonymousCheckoutHref(
  provider: HtmlMembershipCommerceProvider,
  publicUrl = '',
) {
  // Keep the provider parameter explicit so callers cannot accidentally use
  // this predicate for an unnormalized/unknown provider payload.
  void provider;
  const normalized = safeHttpUrl(publicUrl);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized, 'https://kodety.invalid/');
    const key = parsed.searchParams.get('kodety_checkout') || '';
    return /^[A-Za-z0-9_-]{43}$/.test(key);
  } catch {
    return false;
  }
}

export function htmlMembershipCommerceConnectionCanCreateMapping(
  connection: Pick<HtmlMembershipCommerceConnection, 'enabled' | 'status'>,
) {
  return connection.enabled
    && (connection.status === 'connected' || connection.status === 'pending');
}

function commerceEnvironment(value: unknown): HtmlMembershipCommerceEnvironment {
  const candidate = text(value).toLocaleLowerCase();
  return candidate === 'test' || candidate === 'sandbox' ? 'sandbox' : 'production';
}

function purchaseMode(value: unknown): HtmlMembershipPurchaseMode {
  return text(value).toLocaleLowerCase() === 'subscription' ? 'subscription' : 'payment';
}

function commerceConnectionStatus(
  value: unknown,
  enabled = true,
): HtmlMembershipCommerceConnectionStatus {
  const candidate = text(value).toLocaleLowerCase();
  if (
    candidate === 'connected'
    || candidate === 'pending'
    || candidate === 'error'
    || candidate === 'expired'
    || candidate === 'disconnected'
  ) return candidate;
  return enabled ? 'pending' : 'disconnected';
}

function absoluteUrl(value: string, baseUrl?: string) {
  if (typeof window === 'undefined' && !baseUrl && !/^https?:\/\//i.test(value)) {
    throw new Error('baseUrl é obrigatório para URLs relativas fora do navegador.');
  }
  return new URL(value, baseUrl || window.location.href);
}

function appendEndpoint(base: string, path: string, baseUrl?: string) {
  const url = absoluteUrl(base, baseUrl);
  const suffix = path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  if (!suffix) return url;
  const restRoute = url.searchParams.get('rest_route');
  if (restRoute) {
    url.searchParams.set('rest_route', `${restRoute.replace(/\/$/, '')}/${suffix}`);
  } else {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${suffix}`;
  }
  return url;
}

function commerceEndpoint(config: HtmlMembershipApiConfig, path = '') {
  if (!config.commerceBaseUrl) {
    throw new Error('A API privada de checkout não foi configurada neste host.');
  }
  return appendEndpoint(config.commerceBaseUrl, path, config.baseUrl);
}

function endpointWithId(
  base: string,
  template: string | undefined,
  id: string | number,
  baseUrl?: string,
) {
  const encoded = encodeURIComponent(String(id));
  if (template) {
    return absoluteUrl(
      template
        .replaceAll('{id}', encoded)
        .replaceAll('{key}', encoded),
      baseUrl,
    ).toString();
  }
  const url = absoluteUrl(base, baseUrl);
  const restRoute = url.searchParams.get('rest_route');
  if (restRoute) {
    url.searchParams.set('rest_route', `${restRoute.replace(/\/$/, '')}/${encoded}`);
  } else {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${encoded}`;
  }
  return url.toString();
}

async function requestJson<T>(
  config: HtmlMembershipApiConfig,
  url: string | URL,
  init: RequestInit = {},
): Promise<T> {
  const result = await requestJsonResponse<T>(config, url, init);
  return result.payload;
}

async function requestJsonResponse<T>(
  config: HtmlMembershipApiConfig,
  url: string | URL,
  init: RequestInit = {},
): Promise<{ payload: T; response: Response }> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (config.nonce) headers.set(config.nonceHeader || 'X-WP-Nonce', config.nonce);
  const response = await fetch(url, {
    ...init,
    headers,
    credentials: config.credentials || 'same-origin',
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const source = record(payload);
    const message = text(source.message || record(source.data).message)
      || `Membership respondeu com HTTP ${response.status}.`;
    throw new Error(message);
  }
  return { payload: payload as T, response };
}

function normalizeEntitlement(value: unknown): HtmlMembershipMemberEntitlement | null {
  const source = record(value);
  const planKey = normalizeMembershipPlanKey(
    source.planKey ?? source.plan_key ?? source.plan,
  );
  if (!planKey) return null;
  const statuses = new Set<MembershipEntitlementStatus>([
    'active',
    'trialing',
    'past_due',
    'paused',
    'canceled',
    'expired',
    'revoked',
  ]);
  const candidate = text(source.status).toLocaleLowerCase() as MembershipEntitlementStatus;
  return {
    id: typeof source.id === 'number' || typeof source.id === 'string' ? source.id : undefined,
    planKey,
    status: statuses.has(candidate) ? candidate : 'revoked',
    startsAt: text(source.startsAt ?? source.starts_at) || null,
    endsAt: text(source.endsAt ?? source.ends_at ?? source.expiresAt ?? source.expires_at) || null,
    source: text(source.source),
  };
}

export function normalizeHtmlMembershipMember(value: unknown): HtmlMembershipMember {
  const source = record(value);
  const claims = record(source.claims);
  const rawEntitlements = Array.isArray(source.entitlements) ? source.entitlements : [];
  const entitlements = rawEntitlements
    .map(normalizeEntitlement)
    .filter((item): item is HtmlMembershipMemberEntitlement => Boolean(item));
  const rawPlanKeys = source.planKeys ?? source.plan_keys ?? claims.plans;
  const planKeys = Array.isArray(rawPlanKeys)
    ? rawPlanKeys as unknown[]
    : entitlements
      .filter(item => item.status === 'active' || item.status === 'trialing')
      .map(item => item.planKey);
  const statusCandidate = text(
    source.status ?? source.membershipStatus ?? source.membership_status ?? claims.accountStatus,
  ).toLocaleLowerCase();
  const status: HtmlMembershipMemberStatus =
    statusCandidate === 'invited' || statusCandidate === 'suspended'
      ? statusCandidate
      : 'active';
  return {
    id: typeof source.id === 'number' || typeof source.id === 'string' ? source.id : '',
    email: text(source.email),
    displayName: text(source.displayName ?? source.display_name ?? source.name),
    avatarUrl: text(source.avatarUrl ?? source.avatar_url),
    status,
    registeredAt: text(source.registeredAt ?? source.registered_at ?? source.createdAt ?? source.created_at),
    lastLoginAt: text(source.lastLoginAt ?? source.last_login_at),
    entitlements,
    planKeys: Array.from(new Set(
      planKeys.map(normalizeMembershipPlanKey).filter(Boolean),
    )),
  };
}

export function normalizeHtmlMembershipPlan(value: unknown): HtmlMembershipPlan {
  const source = record(value);
  const metadata = record(source.metadata);
  const statusCandidate = text(source.status).toLocaleLowerCase();
  const status: HtmlMembershipPlanStatus =
    statusCandidate === 'draft' || statusCandidate === 'archived'
      ? statusCandidate
      : 'active';
  return {
    id: typeof source.id === 'number' || typeof source.id === 'string'
      ? source.id
      : normalizeMembershipPlanKey(source.key ?? source.slug ?? source.planKey ?? source.plan_key),
    key: normalizeMembershipPlanKey(source.key ?? source.slug ?? source.planKey ?? source.plan_key),
    name: text(source.name ?? source.label),
    description: text(source.description),
    status,
    memberCount: finiteNonNegative(source.memberCount ?? source.member_count),
    upgradeUrl: text(source.upgradeUrl ?? source.upgrade_url ?? metadata.upgradeUrl ?? metadata.upgrade_url),
    provider: text(source.provider ?? metadata.provider),
    externalId: text(source.externalId ?? source.external_id ?? metadata.externalId ?? metadata.external_id),
    createdAt: text(source.createdAt ?? source.created_at),
    updatedAt: text(source.updatedAt ?? source.updated_at),
  };
}

export function normalizeHtmlMembershipOverview(value: unknown): HtmlMembershipOverview {
  const sourceValue = record(value);
  const source = record(sourceValue.overview ?? sourceValue);
  const counts = record(source.counts);
  const capabilities = record(source.capabilities);
  const canManage = booleanValue(capabilities.manage, false);
  const canCreateUsers = booleanValue(capabilities.createUsers ?? capabilities.create_users, false);
  const canAssign = booleanValue(capabilities.assign, false);
  const canCommerce = booleanValue(capabilities.commerce, false);
  const canManageCommerce = booleanValue(
    capabilities.manageCommerce ?? capabilities.manage_commerce,
    canCommerce || booleanValue(
      capabilities.managePlans ?? capabilities.manage_plans,
      false,
    ),
  );
  const manageMembers = booleanValue(
    capabilities.manageMembers ?? capabilities.manage_members,
    canManage,
  );
  return {
    enabled: booleanValue(source.enabled, false),
    memberCount: finiteNonNegative(source.memberCount ?? source.member_count ?? counts.members),
    activeMemberCount: finiteNonNegative(
      source.activeMemberCount ?? source.active_member_count ?? counts.activeMembers ?? counts.active_members,
    ),
    planCount: finiteNonNegative(source.planCount ?? source.plan_count ?? counts.plans),
    capabilities: {
      manageMembers,
      createMembers: booleanValue(
        capabilities.createMembers ?? capabilities.create_members,
        manageMembers && canCreateUsers,
      ),
      assignPlans: booleanValue(
        capabilities.assignPlans ?? capabilities.assign_plans,
        canAssign,
      ),
      manageCommerce: canManageCommerce,
      managePlans: booleanValue(
        capabilities.managePlans ?? capabilities.manage_plans,
        canCommerce,
      ),
      manageSettings: booleanValue(
        capabilities.manageSettings ?? capabilities.manage_settings,
        canCommerce,
      ),
    },
  };
}

export function normalizeHtmlMembershipRuntimeSettings(
  value: unknown,
): HtmlMembershipRuntimeSettings {
  const sourceValue = record(value);
  const source = record(sourceValue.settings ?? sourceValue);
  const enabledProjects = Array.isArray(source.enabledProjects ?? source.enabled_projects)
    ? (source.enabledProjects ?? source.enabled_projects) as unknown[]
    : [];
  return {
    enabled: booleanValue(source.enabled, DEFAULT_RUNTIME_SETTINGS.enabled),
    registrationEnabled: booleanValue(
      source.registrationEnabled ?? source.registration_enabled,
      DEFAULT_RUNTIME_SETTINGS.registrationEnabled,
    ),
    requireEmailVerification: booleanValue(
      source.requireEmailVerification ?? source.require_email_verification,
      DEFAULT_RUNTIME_SETTINGS.requireEmailVerification,
    ),
    enabledProjects: Array.from(new Set(enabledProjects.map(text).filter(Boolean))),
    defaultRole: text(source.defaultRole ?? source.default_role)
      || DEFAULT_RUNTIME_SETTINGS.defaultRole,
    auditRetentionDays: Math.max(30, finiteNonNegative(
      source.auditRetentionDays ?? source.audit_retention_days,
    ) || DEFAULT_RUNTIME_SETTINGS.auditRetentionDays),
    eventRetentionDays: Math.max(30, finiteNonNegative(
      source.eventRetentionDays ?? source.event_retention_days,
    ) || DEFAULT_RUNTIME_SETTINGS.eventRetentionDays),
    loginPageUrl: text(source.loginPageUrl ?? source.login_page_url),
    accountPageUrl: text(source.accountPageUrl ?? source.account_page_url),
    upgradePageUrl: text(source.upgradePageUrl ?? source.upgrade_page_url),
    resetPageUrl: text(source.resetPageUrl ?? source.reset_page_url),
    afterLoginUrl: text(source.afterLoginUrl ?? source.after_login_url),
    afterLogoutUrl: text(source.afterLogoutUrl ?? source.after_logout_url),
  };
}

function commerceCapability(
  capabilities: Record<string, unknown>,
  aliases: string[],
  fallback = false,
) {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(capabilities, alias)) {
      return booleanValue(capabilities[alias], fallback);
    }
  }
  const values = Array.isArray(capabilities.items)
    ? capabilities.items.map(text)
    : [];
  return aliases.some(alias => values.includes(alias)) || fallback;
}

export function normalizeHtmlMembershipCommerceOverview(
  value: unknown,
): HtmlMembershipCommerceOverview {
  const wrapper = record(value);
  const source = record(wrapper.overview ?? wrapper);
  const counts = record(source.counts);
  const connections = record(source.connections);
  const sales = record(source.sales);
  const subscriptions = record(source.subscriptions);
  const rawProviders = Array.isArray(source.providers) ? source.providers : [];
  return {
    providers: rawProviders.map(rawProvider => {
      const provider = record(rawProvider);
      const rawCapabilities = provider.capabilities;
      return {
        id: normalizeHtmlMembershipCommerceProvider(provider.id ?? provider.provider),
        label: text(provider.label ?? provider.name),
        available: booleanValue(provider.available, true),
        capabilities: Array.isArray(rawCapabilities)
          ? rawCapabilities.map(text).filter(Boolean)
          : Object.entries(record(rawCapabilities))
              .filter(([, enabled]) => booleanValue(enabled))
              .map(([key]) => key),
      };
    }),
    connectionCount: finiteNonNegative(
      source.connectionCount ?? source.connection_count ?? counts.connections ?? connections.total,
    ),
    activeConnectionCount: finiteNonNegative(
      source.activeConnectionCount
        ?? source.active_connection_count
        ?? counts.activeConnections
        ?? counts.active_connections
        ?? connections.active,
    ),
    attentionConnectionCount: finiteNonNegative(
      source.attentionConnectionCount
        ?? source.attention_connection_count
        ?? connections.attention,
    ),
    mappedPlanCount: finiteNonNegative(
      source.mappedPlanCount ?? source.mapped_plan_count ?? counts.mappings ?? counts.mappedPlans,
    ),
    saleCount: finiteNonNegative(
      source.saleCount ?? source.sale_count ?? counts.sales ?? sales.total,
    ),
    paidSaleCount: finiteNonNegative(
      source.paidSaleCount ?? source.paid_sale_count ?? sales.paid,
    ),
    pendingSaleCount: finiteNonNegative(
      source.pendingSaleCount ?? source.pending_sale_count ?? sales.pending,
    ),
    refundedSaleCount: finiteNonNegative(
      source.refundedSaleCount ?? source.refunded_sale_count ?? sales.refunded,
    ),
    activeSubscriptionCount: finiteNonNegative(
      source.activeSubscriptionCount
        ?? source.active_subscription_count
        ?? counts.activeSubscriptions
        ?? counts.active_subscriptions
        ?? subscriptions.active,
    ),
    trialingSubscriptionCount: finiteNonNegative(
      source.trialingSubscriptionCount
        ?? source.trialing_subscription_count
        ?? subscriptions.trialing,
    ),
    pastDueSubscriptionCount: finiteNonNegative(
      source.pastDueSubscriptionCount
        ?? source.past_due_subscription_count
        ?? subscriptions.pastDue
        ?? subscriptions.past_due,
    ),
    unlinkedSaleCount: finiteNonNegative(
      source.unlinkedSaleCount ?? source.unlinked_sale_count ?? source.unlinkedSales,
    ),
  };
}

export function normalizeHtmlMembershipCommerceConnection(
  value: unknown,
): HtmlMembershipCommerceConnection {
  const wrapper = record(value);
  const source = record(wrapper.connection ?? wrapper);
  const settings = record(source.settings);
  const account = record(source.account);
  const rawCapabilities = source.capabilities;
  const capabilities = Array.isArray(rawCapabilities)
    ? { items: rawCapabilities }
    : record(rawCapabilities);
  const rawCredentials = source.credentials;
  const credentialFields = Array.isArray(rawCredentials)
    ? rawCredentials.map(text).filter(Boolean)
    : Object.keys(record(rawCredentials));
  const enabled = booleanValue(source.enabled, true);
  return {
    id: typeof source.id === 'number' || typeof source.id === 'string' ? source.id : '',
    provider: normalizeHtmlMembershipCommerceProvider(source.provider),
    name: text(source.name ?? source.label),
    enabled,
    status: commerceConnectionStatus(source.status, enabled),
    environment: commerceEnvironment(
      source.environment ?? settings.environment ?? settings.mode ?? source.mode,
    ),
    accountId: text(source.accountId ?? source.account_id ?? account.id),
    accountName: text(source.accountName ?? source.account_name ?? account.name),
    credentialFields: Array.from(new Set(credentialFields)),
    capabilities: {
      hostedCheckout: commerceCapability(capabilities, [
        'hostedCheckout',
        'hosted_checkout',
        'checkout',
      ]),
      oneTime: commerceCapability(capabilities, ['oneTime', 'one_time', 'payments']),
      subscriptions: commerceCapability(capabilities, ['subscriptions', 'recurring']),
      customerPortal: commerceCapability(capabilities, [
        'customerPortal',
        'customer_portal',
        'portal',
      ]),
      products: commerceCapability(capabilities, ['products', 'catalog']),
      oauth: commerceCapability(capabilities, ['oauth', 'connect']),
    },
    dashboardUrl: safeHttpUrl(source.dashboardUrl ?? source.dashboard_url),
    connectUrl: safeHttpUrl(
      source.connectUrl
        ?? source.connect_url
        ?? source.authorizationUrl
        ?? source.authorization_url,
    ),
    webhookUrl: safeHttpUrl(source.webhookUrl ?? source.webhook_url),
    errorMessage: text(source.errorMessage ?? source.error_message ?? source.lastError ?? source.last_error),
    lastVerifiedAt: text(source.lastVerifiedAt ?? source.last_verified_at),
    lastSyncedAt: text(source.lastSyncedAt ?? source.last_synced_at),
    createdAt: text(source.createdAt ?? source.created_at),
    updatedAt: text(source.updatedAt ?? source.updated_at),
  };
}

export function normalizeHtmlMembershipCommerceProduct(
  value: unknown,
): HtmlMembershipCommerceProduct {
  const source = record(value);
  const rawPrices = Array.isArray(source.prices)
    ? source.prices
    : Array.isArray(source.priceOptions ?? source.price_options)
      ? source.priceOptions ?? source.price_options
      : [];
  const flatPriceId = text(source.priceId ?? source.price_id);
  const prices = (rawPrices as unknown[]).map(rawPrice => {
    const price = record(rawPrice);
    return {
      id: text(price.id ?? price.externalId ?? price.external_id),
      name: text(price.name ?? price.label),
      active: booleanValue(price.active, true),
      mode: purchaseMode(price.mode ?? source.mode),
      currency: text(price.currency).toLocaleUpperCase(),
      amount: nullableNumber(price.amount ?? price.unitAmount ?? price.unit_amount),
      interval: text(price.interval ?? price.recurringInterval ?? price.recurring_interval),
    };
  }).filter(price => Boolean(price.id));
  if (flatPriceId && !prices.some(price => price.id === flatPriceId)) {
    prices.unshift({
      id: flatPriceId,
      name: text(source.priceName ?? source.price_name),
      active: booleanValue(source.active, true),
      mode: purchaseMode(source.mode),
      currency: text(source.currency).toLocaleUpperCase(),
      amount: nullableNumber(source.amount),
      interval: text(source.interval),
    });
  }
  return {
    id: text(source.id ?? source.externalId ?? source.external_id) || flatPriceId,
    name: text(source.name ?? source.label),
    description: text(source.description),
    active: booleanValue(source.active, true),
    mode: purchaseMode(source.mode),
    prices,
  };
}

/**
 * Stripe returns one flat row per price. Merge rows by product so the Builder
 * can select every price without duplicate React keys or silently choosing the
 * first price only.
 */
export function normalizeHtmlMembershipCommerceProducts(
  values: readonly unknown[],
): HtmlMembershipCommerceProduct[] {
  const products = new Map<string, HtmlMembershipCommerceProduct>();
  for (const value of values) {
    const product = normalizeHtmlMembershipCommerceProduct(value);
    if (!product.id) continue;
    const current = products.get(product.id);
    if (!current) {
      products.set(product.id, product);
      continue;
    }
    const prices = new Map(current.prices.map(price => [price.id, price]));
    for (const price of product.prices) {
      if (!prices.has(price.id)) prices.set(price.id, price);
    }
    products.set(product.id, {
      ...current,
      name: current.name || product.name,
      description: current.description || product.description,
      active: current.active || product.active,
      prices: [...prices.values()],
    });
  }
  return [...products.values()];
}

export function normalizeHtmlMembershipCommerceSyncResult(
  value: unknown,
): HtmlMembershipCommerceSyncResult {
  const wrapper = record(value);
  const source = record(wrapper.result ?? wrapper.sync ?? wrapper);
  return {
    checked: finiteNonNegative(source.checked),
    projected: finiteNonNegative(source.projected),
    ignored: finiteNonNegative(source.ignored),
    failed: finiteNonNegative(source.failed),
    staleEventsRecovered: finiteNonNegative(
      source.staleEventsRecovered ?? source.stale_events_recovered,
    ),
    piiPurged: finiteNonNegative(source.piiPurged ?? source.pii_purged),
  };
}

export function normalizeHtmlMembershipCommerceMapping(
  value: unknown,
): HtmlMembershipCommerceMapping {
  const wrapper = record(value);
  const source = record(wrapper.mapping ?? wrapper);
  const plan = record(source.plan);
  const connection = record(source.connection);
  return {
    id: typeof source.id === 'number' || typeof source.id === 'string' ? source.id : '',
    connectionId: identifier(
      source.connectionId ?? source.connection_id ?? connection.id,
    ) ?? '',
    planId: identifier(source.planId ?? source.plan_id ?? plan.id) ?? '',
    planKey: normalizeMembershipPlanKey(
      source.planKey ?? source.plan_key ?? source.planSlug ?? source.plan_slug ?? plan.key ?? plan.slug,
    ),
    planName: text(source.planName ?? source.plan_name ?? plan.name),
    provider: normalizeHtmlMembershipCommerceProvider(source.provider ?? connection.provider),
    externalProductId: text(source.externalProductId ?? source.external_product_id),
    externalPriceId: text(source.externalPriceId ?? source.external_price_id),
    mode: purchaseMode(source.mode),
    currency: text(source.currency).toLocaleUpperCase(),
    amount: nullableNumber(source.amount),
    status: text(source.status).toLocaleLowerCase() || 'active',
    publicKey: text(source.publicKey ?? source.public_key),
    publicUrl: safeHttpUrl(source.publicUrl ?? source.public_url),
    createdAt: text(source.createdAt ?? source.created_at),
    updatedAt: text(source.updatedAt ?? source.updated_at),
  };
}

function normalizeCommerceRecord(value: unknown): HtmlMembershipCommerceRecord {
  const source = record(value);
  const customer = record(source.customer);
  const member = record(source.member ?? source.user);
  const plan = record(source.plan);
  return {
    id: typeof source.id === 'number' || typeof source.id === 'string' ? source.id : '',
    provider: normalizeHtmlMembershipCommerceProvider(source.provider),
    connectionId: identifier(source.connectionId ?? source.connection_id) ?? '',
    externalId: text(
      source.externalId
        ?? source.external_id
        ?? source.externalSaleId
        ?? source.external_sale_id
        ?? source.externalPaymentId
        ?? source.external_payment_id
        ?? source.externalContractId
        ?? source.external_contract_id,
    ),
    externalCustomerId: text(source.externalCustomerId ?? source.external_customer_id),
    externalContractId: text(source.externalContractId ?? source.external_contract_id),
    status: text(source.status).toLocaleLowerCase() || 'pending',
    accessStatus: text(source.accessStatus ?? source.access_status),
    environment: commerceEnvironment(source.environment),
    userId: positiveIdentifier(source.userId ?? source.user_id ?? member.id),
    customerName: text(
      source.customerName
        ?? source.customer_name
        ?? source.memberName
        ?? source.member_name
        ?? customer.name
        ?? member.displayName
        ?? member.display_name,
    ),
    customerEmail: text(
      source.customerEmail
        ?? source.customer_email
        ?? source.memberEmail
        ?? source.member_email
        ?? customer.email
        ?? member.email,
    ),
    planId: identifier(source.planId ?? source.plan_id ?? plan.id),
    planKey: normalizeMembershipPlanKey(
      source.planKey ?? source.plan_key ?? source.planSlug ?? source.plan_slug ?? plan.key ?? plan.slug,
    ),
    planName: text(source.planName ?? source.plan_name ?? plan.name),
    currency: text(source.currency).toLocaleUpperCase(),
    amount: nullableNumber(source.amount ?? source.total ?? source.value),
    dashboardUrl: safeHttpUrl(source.dashboardUrl ?? source.dashboard_url),
    occurredAt: text(source.occurredAt ?? source.occurred_at),
    createdAt: text(
      source.createdAt
        ?? source.created_at
        ?? source.paidAt
        ?? source.paid_at
        ?? source.startedAt
        ?? source.started_at,
    ),
    updatedAt: text(source.updatedAt ?? source.updated_at),
  };
}

export function normalizeHtmlMembershipCommerceSale(
  value: unknown,
): HtmlMembershipCommerceRecord {
  return normalizeCommerceRecord(value);
}

export function normalizeHtmlMembershipCommerceSubscription(
  value: unknown,
): HtmlMembershipCommerceSubscription {
  const source = record(value);
  const normalized = normalizeCommerceRecord(value);
  return {
    ...normalized,
    currentPeriodStart: text(source.currentPeriodStart ?? source.current_period_start),
    currentPeriodEnd: text(source.currentPeriodEnd ?? source.current_period_end),
    trialEndsAt: text(source.trialEndsAt ?? source.trial_ends_at),
    canceledAt: text(source.canceledAt ?? source.canceled_at),
    endedAt: text(source.endedAt ?? source.ended_at),
    portalAvailable: booleanValue(
      source.portalAvailable ?? source.portal_available,
      Boolean(source.portalUrl ?? source.portal_url),
    ),
  };
}

function normalizeCheckoutLink(value: unknown): HtmlMembershipCheckoutLink {
  const wrapper = record(value);
  const source = record(wrapper.checkoutLink ?? wrapper.checkout_link ?? wrapper);
  const url = safeHttpUrl(source.url ?? source.checkoutUrl ?? source.checkout_url);
  if (!url) throw new Error('O provedor não retornou um link de checkout válido.');
  return {
    id: typeof source.id === 'number' || typeof source.id === 'string' ? source.id : '',
    url,
    provider: normalizeHtmlMembershipCommerceProvider(source.provider),
    expiresAt: text(source.expiresAt ?? source.expires_at),
  };
}

function normalizeEphemeralLink(value: unknown): HtmlMembershipEphemeralLink {
  const wrapper = record(value);
  const source = record(wrapper.link ?? wrapper);
  const url = safeHttpUrl(source.url);
  if (!url) throw new Error('O WordPress não retornou um link temporário válido.');
  return {
    url,
    expiresAt: text(source.expiresAt ?? source.expires_at),
  };
}

function unwrapMember(value: unknown) {
  const source = record(value);
  return normalizeHtmlMembershipMember(source.member ?? source.user ?? source);
}

function unwrapPlan(value: unknown) {
  const source = record(value);
  return normalizeHtmlMembershipPlan(source.plan ?? source);
}

export function membershipApiConfigFromWordPressConfig(
  config: HtmlMembershipWordPressConfig | null | undefined,
): HtmlMembershipApiConfig | null {
  if (
    !config?.membersOverviewUrl
    || !config.membersUsersUrl
    || !config.membersPlansUrl
    || !config.membersSettingsUrl
  ) return null;
  return {
    projectId: config.projectId,
    overviewUrl: config.membersOverviewUrl,
    usersUrl: config.membersUsersUrl,
    userUrl: config.membersUserUrl,
    plansUrl: config.membersPlansUrl,
    planUrl: config.membersPlanUrl,
    settingsUrl: config.membersSettingsUrl,
    activationUrl: config.membersActivationUrl,
    commerceBaseUrl: config.membersCommerceUrl,
    nonce: config.nonce,
  };
}

export function createHtmlMembershipClient(
  config: HtmlMembershipApiConfig,
): HtmlMembershipDataSource {
  return {
    async loadOverview(signal) {
      const url = absoluteUrl(config.overviewUrl, config.baseUrl);
      if (config.projectId) url.searchParams.set('project', config.projectId);
      const payload = await requestJson<unknown>(
        config,
        url,
        { signal, cache: 'no-store' },
      );
      return normalizeHtmlMembershipOverview(payload);
    },
    async setEnabled(enabled) {
      await requestJson<unknown>(
        config,
        absoluteUrl(config.activationUrl || config.overviewUrl, config.baseUrl),
        {
          method: 'POST',
          body: JSON.stringify({
            enabled,
            ...(config.projectId ? { projectId: config.projectId } : {}),
          }),
        },
      );
      const url = absoluteUrl(config.overviewUrl, config.baseUrl);
      if (config.projectId) url.searchParams.set('project', config.projectId);
      const payload = await requestJson<unknown>(
        config,
        url,
        { cache: 'no-store' },
      );
      return normalizeHtmlMembershipOverview(payload);
    },
    async loadMembers(request = {}) {
      const url = absoluteUrl(config.usersUrl, config.baseUrl);
      url.searchParams.set('page', String(Math.max(1, request.page || 1)));
      url.searchParams.set('per_page', String(Math.max(1, Math.min(100, request.perPage || 20))));
      if (request.search?.trim()) url.searchParams.set('search', request.search.trim());
      if (request.status) url.searchParams.set('status', request.status);
      if (request.planKey) url.searchParams.set('plan', normalizeMembershipPlanKey(request.planKey));
      const { payload, response } = await requestJsonResponse<unknown>(
        config,
        url,
        { signal: request.signal, cache: 'no-store' },
      );
      const source = record(payload);
      const values = Array.isArray(source.items)
        ? source.items
        : Array.isArray(source.members)
          ? source.members
          : Array.isArray(source.users)
            ? source.users
            : [];
      const headerTotal = finiteNonNegative(response.headers.get('X-WP-Total'));
      const headerTotalPages = finiteNonNegative(response.headers.get('X-WP-TotalPages'));
      const total = finiteNonNegative(source.total) || headerTotal || values.length;
      return {
        items: values.map(normalizeHtmlMembershipMember),
        total,
        totalPages: Math.max(
          1,
          finiteNonNegative(source.totalPages ?? source.total_pages)
            || headerTotalPages
            || Math.ceil(total / Math.max(1, request.perPage || 20)),
        ),
        page: Math.max(1, finiteNonNegative(source.page) || request.page || 1),
      };
    },
    async createMember(input) {
      const payload = await requestJson<unknown>(
        config,
        absoluteUrl(config.usersUrl, config.baseUrl),
        { method: 'POST', body: JSON.stringify(input) },
      );
      return unwrapMember(payload);
    },
    async updateMember(id, input) {
      const payload = await requestJson<unknown>(
        config,
        endpointWithId(config.usersUrl, config.userUrl, id, config.baseUrl),
        { method: 'PUT', body: JSON.stringify(input) },
      );
      return unwrapMember(payload);
    },
    async loadMember(id, signal) {
      const payload = await requestJson<unknown>(
        config,
        endpointWithId(config.usersUrl, config.userUrl, id, config.baseUrl),
        { signal, cache: 'no-store' },
      );
      return unwrapMember(payload);
    },
    async deleteMember(id) {
      await requestJson<unknown>(
        config,
        endpointWithId(config.usersUrl, config.userUrl, id, config.baseUrl),
        { method: 'DELETE' },
      );
    },
    async loadPlans(signal) {
      const values: unknown[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const url = absoluteUrl(config.plansUrl, config.baseUrl);
        url.searchParams.set('page', String(page));
        url.searchParams.set('per_page', '100');
        const { payload, response } = await requestJsonResponse<unknown>(
          config,
          url,
          { signal, cache: 'no-store' },
        );
        const source = record(payload);
        const items = Array.isArray(source.items)
          ? source.items
          : Array.isArray(source.plans)
            ? source.plans
            : Array.isArray(payload)
              ? payload
              : [];
        values.push(...items);
        totalPages = Math.max(
          1,
          finiteNonNegative(source.totalPages ?? source.total_pages)
            || finiteNonNegative(response.headers.get('X-WP-TotalPages'))
            || 1,
        );
        if (totalPages > 100) {
          throw new Error('O catálogo excede o limite seguro de 10.000 planos no Builder.');
        }
        page += 1;
      } while (page <= totalPages);
      const plans = values.map(normalizeHtmlMembershipPlan);
      return Array.from(new Map(plans.map(plan => [String(plan.id), plan])).values());
    },
    async createPlan(input) {
      const metadata = {
        upgradeUrl: input.upgradeUrl || '',
        provider: input.provider || '',
        externalId: input.externalId || '',
      };
      const payload = await requestJson<unknown>(
        config,
        absoluteUrl(config.plansUrl, config.baseUrl),
        {
          method: 'POST',
          body: JSON.stringify({
            ...input,
            slug: input.key,
            metadata,
          }),
        },
      );
      return unwrapPlan(payload);
    },
    async updatePlan(id, input) {
      const metadata = {
        upgradeUrl: input.upgradeUrl || '',
        provider: input.provider || '',
        externalId: input.externalId || '',
      };
      const payload = await requestJson<unknown>(
        config,
        endpointWithId(config.plansUrl, config.planUrl, id, config.baseUrl),
        {
          method: 'PUT',
          body: JSON.stringify({
            ...input,
            slug: input.key,
            metadata,
          }),
        },
      );
      return unwrapPlan(payload);
    },
    async deletePlan(id) {
      await requestJson<unknown>(
        config,
        endpointWithId(config.plansUrl, config.planUrl, id, config.baseUrl),
        { method: 'DELETE' },
      );
    },
    async loadSettings(signal) {
      const payload = await requestJson<unknown>(
        config,
        absoluteUrl(config.settingsUrl, config.baseUrl),
        { signal, cache: 'no-store' },
      );
      return normalizeHtmlMembershipRuntimeSettings(payload);
    },
    async saveSettings(input) {
      const payload = await requestJson<unknown>(
        config,
        absoluteUrl(config.settingsUrl, config.baseUrl),
        {
          method: 'PUT',
          body: JSON.stringify({
            registrationEnabled: input.registrationEnabled,
            defaultRole: input.defaultRole,
            auditRetentionDays: input.auditRetentionDays,
            eventRetentionDays: input.eventRetentionDays,
            requireEmailVerification: input.requireEmailVerification,
            loginPageUrl: input.loginPageUrl,
            accountPageUrl: input.accountPageUrl,
            upgradePageUrl: input.upgradePageUrl,
            resetPageUrl: input.resetPageUrl,
            afterLoginUrl: input.afterLoginUrl,
            afterLogoutUrl: input.afterLogoutUrl,
          }),
        },
      );
      return normalizeHtmlMembershipRuntimeSettings(payload);
    },
    commerceAvailable: Boolean(config.commerceBaseUrl),
    async loadCommerceOverview(signal) {
      const payload = await requestJson<unknown>(
        config,
        commerceEndpoint(config, 'overview'),
        { signal, cache: 'no-store' },
      );
      return normalizeHtmlMembershipCommerceOverview(payload);
    },
    async syncCommerce(limit = 25) {
      const payload = await requestJson<unknown>(
        config,
        commerceEndpoint(config, 'sync'),
        {
          method: 'POST',
          body: JSON.stringify({
            limit: Math.max(1, Math.min(100, Math.trunc(limit) || 25)),
          }),
        },
      );
      return normalizeHtmlMembershipCommerceSyncResult(payload);
    },
    async loadCommerceConnections(signal) {
      const payload = await requestJson<unknown>(
        config,
        commerceEndpoint(config, 'connections'),
        { signal, cache: 'no-store' },
      );
      const source = record(payload);
      const items = Array.isArray(source.items)
        ? source.items
        : Array.isArray(source.connections)
          ? source.connections
          : Array.isArray(payload)
            ? payload
            : [];
      return items.map(normalizeHtmlMembershipCommerceConnection);
    },
    async createCommerceConnection(input) {
      const payload = await requestJson<unknown>(
        config,
        commerceEndpoint(config, 'connections'),
        { method: 'POST', body: JSON.stringify(input) },
      );
      return normalizeHtmlMembershipCommerceConnection(payload);
    },
    async updateCommerceConnection(id, input) {
      const payload = await requestJson<unknown>(
        config,
        commerceEndpoint(config, `connections/${id}`),
        { method: 'PATCH', body: JSON.stringify(input) },
      );
      return normalizeHtmlMembershipCommerceConnection(payload);
    },
    async deleteCommerceConnection(id) {
      await requestJson<unknown>(
        config,
        commerceEndpoint(config, `connections/${id}`),
        { method: 'DELETE' },
      );
    },
    async testCommerceConnection(id) {
      await requestJson<unknown>(
        config,
        commerceEndpoint(config, `connections/${id}/test`),
        { method: 'POST', body: JSON.stringify({}) },
      );
      const payload = await requestJson<unknown>(
        config,
        commerceEndpoint(config, `connections/${id}`),
        { cache: 'no-store' },
      );
      return normalizeHtmlMembershipCommerceConnection(payload);
    },
    async loadCommerceProducts(connectionId, signal) {
      const values: unknown[] = [];
      let cursor = '';
      for (let page = 0; page < 100; page += 1) {
        const url = commerceEndpoint(config, `connections/${connectionId}/products`);
        if (cursor) url.searchParams.set('cursor', cursor);
        const payload = await requestJson<unknown>(
          config,
          url,
          { signal, cache: 'no-store' },
        );
        const source = record(payload);
        const items = Array.isArray(source.items)
          ? source.items
          : Array.isArray(source.products)
            ? source.products
            : Array.isArray(payload)
              ? payload
              : [];
        values.push(...items);
        const nextCursor = text(source.nextCursor ?? source.next_cursor);
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
        if (page === 99) {
          throw new Error('O catálogo do provedor excedeu o limite seguro de paginação.');
        }
      }
      return normalizeHtmlMembershipCommerceProducts(values);
    },
    async loadCommerceMappings(signal) {
      const payload = await requestJson<unknown>(
        config,
        commerceEndpoint(config, 'mappings'),
        { signal, cache: 'no-store' },
      );
      const source = record(payload);
      const items = Array.isArray(source.items)
        ? source.items
        : Array.isArray(source.mappings)
          ? source.mappings
          : Array.isArray(payload)
            ? payload
            : [];
      return items.map(normalizeHtmlMembershipCommerceMapping);
    },
    async createCommerceMapping(input) {
      const payload = await requestJson<unknown>(
        config,
        commerceEndpoint(config, 'mappings'),
        { method: 'POST', body: JSON.stringify(input) },
      );
      return normalizeHtmlMembershipCommerceMapping(payload);
    },
    async updateCommerceMapping(id, input) {
      const payload = await requestJson<unknown>(
        config,
        commerceEndpoint(config, `mappings/${id}`),
        { method: 'PATCH', body: JSON.stringify(input) },
      );
      return normalizeHtmlMembershipCommerceMapping(payload);
    },
    async deleteCommerceMapping(id) {
      await requestJson<unknown>(
        config,
        commerceEndpoint(config, `mappings/${id}`),
        { method: 'DELETE' },
      );
    },
    async createCheckoutLink(input) {
      const payload = await requestJson<unknown>(
        config,
        commerceEndpoint(config, 'checkout-links'),
        { method: 'POST', body: JSON.stringify(input) },
      );
      return normalizeCheckoutLink(payload);
    },
    async loadCommerceSales(request = {}) {
      const url = commerceEndpoint(config, 'sales');
      const perPage = Math.max(1, Math.min(100, request.perPage || 20));
      url.searchParams.set('page', String(Math.max(1, request.page || 1)));
      url.searchParams.set('per_page', String(perPage));
      if (request.search?.trim()) url.searchParams.set('search', request.search.trim());
      if (request.status) url.searchParams.set('status', request.status);
      if (request.provider) url.searchParams.set('provider', request.provider);
      const { payload, response } = await requestJsonResponse<unknown>(
        config,
        url,
        { signal: request.signal, cache: 'no-store' },
      );
      const source = record(payload);
      const items = Array.isArray(source.items) ? source.items : [];
      const total = finiteNonNegative(source.total)
        || finiteNonNegative(response.headers.get('X-WP-Total'))
        || items.length;
      return {
        items: items.map(normalizeHtmlMembershipCommerceSale),
        total,
        totalPages: Math.max(
          1,
          finiteNonNegative(source.totalPages ?? source.total_pages)
            || finiteNonNegative(response.headers.get('X-WP-TotalPages'))
            || Math.ceil(total / perPage),
        ),
        page: Math.max(1, finiteNonNegative(source.page) || request.page || 1),
      };
    },
    async loadCommerceSubscriptions(request = {}) {
      const url = commerceEndpoint(config, 'subscriptions');
      const perPage = Math.max(1, Math.min(100, request.perPage || 20));
      url.searchParams.set('page', String(Math.max(1, request.page || 1)));
      url.searchParams.set('per_page', String(perPage));
      if (request.search?.trim()) url.searchParams.set('search', request.search.trim());
      if (request.status) url.searchParams.set('status', request.status);
      if (request.provider) url.searchParams.set('provider', request.provider);
      const { payload, response } = await requestJsonResponse<unknown>(
        config,
        url,
        { signal: request.signal, cache: 'no-store' },
      );
      const source = record(payload);
      const items = Array.isArray(source.items) ? source.items : [];
      const total = finiteNonNegative(source.total)
        || finiteNonNegative(response.headers.get('X-WP-Total'))
        || items.length;
      return {
        items: items.map(normalizeHtmlMembershipCommerceSubscription),
        total,
        totalPages: Math.max(
          1,
          finiteNonNegative(source.totalPages ?? source.total_pages)
            || finiteNonNegative(response.headers.get('X-WP-TotalPages'))
            || Math.ceil(total / perPage),
        ),
        page: Math.max(1, finiteNonNegative(source.page) || request.page || 1),
      };
    },
    async createSubscriptionPortalLink(id) {
      const payload = await requestJson<unknown>(
        config,
        commerceEndpoint(config, `subscriptions/${id}/portal-link`),
        { method: 'POST', body: JSON.stringify({}) },
      );
      return normalizeEphemeralLink(payload);
    },
    async createMemberAccessLink(id) {
      const payload = await requestJson<unknown>(
        config,
        commerceEndpoint(config, `members/${id}/access-link`),
        { method: 'POST', body: JSON.stringify({}) },
      );
      return normalizeEphemeralLink(payload);
    },
    async createMemberResetLink(id) {
      const payload = await requestJson<unknown>(
        config,
        commerceEndpoint(config, `members/${id}/reset-link`),
        { method: 'POST', body: JSON.stringify({}) },
      );
      return normalizeEphemeralLink(payload);
    },
    async sendMemberResetEmail(id) {
      await requestJson<unknown>(
        config,
        commerceEndpoint(config, `members/${id}/reset-email`),
        { method: 'POST', body: JSON.stringify({}) },
      );
    },
    async changeMemberAccess(id, input) {
      const payload = await requestJson<unknown>(
        config,
        commerceEndpoint(config, `members/${id}/access`),
        { method: 'POST', body: JSON.stringify(input) },
      );
      const source = record(payload);
      const access = text(source.access);
      if (access !== 'granted' && access !== 'revoked' && access !== 'restored') {
        throw new Error('O WordPress não confirmou a alteração de acesso.');
      }
      return {
        access,
        billingUnaffected: booleanValue(
          source.billingUnaffected ?? source.billing_unaffected,
          access === 'revoked',
        ),
        requiresSync: booleanValue(source.requiresSync ?? source.requires_sync),
      };
    },
  };
}
