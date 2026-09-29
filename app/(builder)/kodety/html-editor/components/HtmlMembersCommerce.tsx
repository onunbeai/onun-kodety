'use client';

import { DisclosureSummary } from '@/components/ui/disclosure-summary';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AlertTriangle,
  Cable,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  ExternalLink,
  KeyRound,
  Link2,
  Loader2,
  Pencil,
  Plug,
  ReceiptText,
  RefreshCw,
  RotateCw,
  ShoppingCart,
  Trash2,
  UserRoundCog,
  WalletCards,
} from '@/components/ui/gravity-icons';
import { toast } from 'sonner';
import { getAdminNumberFormatter, getAdminUiLocale } from '@/lib/admin-ui-locale';
import { builderOnboardingDialogProps, useBuilderOnboardingActive } from '@/lib/html-editor/onboarding-active';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  HTML_MEMBERSHIP_COMMERCE_PROVIDERS,
  htmlMembershipCommerceConnectionCanCreateMapping,
  htmlMembershipCommerceRequiresCustomerEmail,
  htmlMembershipCommerceSupportsAnonymousCheckoutHref,
  type HtmlMembershipCommerceConnection,
  type HtmlMembershipCommerceEnvironment,
  type HtmlMembershipCommerceMapping,
  type HtmlMembershipCommerceOverview,
  type HtmlMembershipCommerceProduct,
  type HtmlMembershipCommerceProvider,
  type HtmlMembershipCommerceRecord,
  type HtmlMembershipCommerceSubscription,
  type HtmlMembershipDataSource,
  type HtmlMembershipEphemeralLink,
  type HtmlMembershipPlan,
  type HtmlMembershipPurchaseMode,
  type SaveHtmlMembershipCommerceConnectionInput,
} from '@/lib/html-editor/membership-client';
import { cn } from '@/lib/utils';

type CommerceSection = 'checkout' | 'sales' | 'subscriptions';

interface ProviderDefinition {
  label: string;
  description: string;
  credentialFields: Array<{ key: string; label: string; placeholder: string }>;
  webhookEvents: string;
}

const PROVIDERS: Record<HtmlMembershipCommerceProvider, ProviderDefinition> = {
  stripe: {
    label: 'Stripe',
    description: 'Checkout hospedado, Billing e portal; meios disponíveis dependem da conta Stripe.',
    credentialFields: [
      { key: 'secretKey', label: 'Chave secreta', placeholder: 'sk_live_…' },
      { key: 'webhookSecret', label: 'Segredo do webhook', placeholder: 'whsec_…' },
      { key: 'accountId', label: 'Connected account ID · opcional', placeholder: 'acct_…' },
    ],
    webhookEvents: 'checkout.session.completed/expired, invoice.paid/payment_failed/finalization_failed/voided/marked_uncollectible, customer.subscription.updated/deleted, charge.refunded e charge.dispute.*',
  },
  mercado_pago: {
    label: 'Mercado Pago',
    description: 'Checkout Pro, Pix, cartão e notificações de pagamento.',
    credentialFields: [
      { key: 'accessToken', label: 'Access token', placeholder: 'APP_USR-…' },
      { key: 'webhookSecret', label: 'Assinatura secreta', placeholder: 'Segredo do webhook' },
    ],
    webhookEvents: 'payment.created e payment.updated',
  },
  asaas: {
    label: 'Asaas',
    description: 'Checkout Pix/cartão e assinaturas; outros meios não são configurados nesta tela.',
    credentialFields: [
      { key: 'apiKey', label: 'API key', placeholder: '$aact_…' },
      { key: 'webhookToken', label: 'Token do webhook', placeholder: 'Token forte e exclusivo' },
    ],
    webhookEvents: 'CHECKOUT_*, PAYMENT_* e SUBSCRIPTION_*',
  },
  pagbank: {
    label: 'PagBank',
    description: 'Checkout avulso, Pix e cartão; token e e-mail mantêm também o ciclo legado de estorno e disputa. Sem recorrência neste adaptador.',
    credentialFields: [
      {
        key: 'token',
        label: 'Token da conta',
        placeholder: 'Usado pela API e para validar o SHA-256 do webhook',
      },
      {
        key: 'accountEmail',
        label: 'E-mail da conta',
        placeholder: 'conta@exemplo.com',
      },
    ],
    webhookEvents: 'eventos de checkout/pagamento e notificações transacionais legadas',
  },
  pagarme: {
    label: 'Pagar.me',
    description: 'Links de pagamento e recorrência; split e marketplace continuam no painel do provedor.',
    credentialFields: [
      { key: 'secretKey', label: 'Chave secreta', placeholder: 'sk_…' },
    ],
    webhookEvents: 'charge.*, order.*, subscription.*, invoice.* e chargeback.received',
  },
  woovi: {
    label: 'Woovi',
    description: 'Checkout Pix-first com assinatura RSA; a landing Kodety captura e verifica o e-mail do membro.',
    credentialFields: [
      { key: 'appId', label: 'App ID', placeholder: 'App ID da Woovi' },
    ],
    webhookEvents: 'CHARGE_* e eventos de reembolso/contestação',
  },
  iugu: {
    label: 'Iugu',
    description: 'Fatura avulsa hospedada; a landing Kodety captura e verifica o e-mail exigido pelo provedor.',
    credentialFields: [
      { key: 'apiToken', label: 'API token', placeholder: 'Token da conta' },
    ],
    webhookEvents: 'invoice.*',
  },
  hotmart: {
    label: 'Hotmart',
    description: 'Checkout de ofertas Hotmart, vendas e assinaturas com OAuth e Hottok por conexão.',
    credentialFields: [
      { key: 'clientId', label: 'Client ID', placeholder: 'Client ID da credencial Hotmart' },
      { key: 'clientSecret', label: 'Client secret', placeholder: 'Client secret da credencial Hotmart' },
      { key: 'basicToken', label: 'Basic token', placeholder: 'Token Basic exibido pela Hotmart' },
      { key: 'hottok', label: 'Hottok do webhook', placeholder: 'Hottok exclusivo desta conexão' },
    ],
    webhookEvents: 'PURCHASE_APPROVED/COMPLETE/DELAYED/CANCELED/REFUNDED/CHARGEBACK/EXPIRED e eventos de assinatura',
  },
  ticto: {
    label: 'Ticto',
    description: 'Checkout de ofertas Ticto com webhook v2 autenticado e ciclo completo de vendas e assinaturas.',
    credentialFields: [
      { key: 'webhookToken', label: 'Token ultra secreto do webhook v2', placeholder: 'Token configurado no webhook Ticto' },
    ],
    webhookEvents: 'authorized, refunded, chargeback, subscription_delayed/canceled, trial_started/ended, uncanceled e all_charges_paid',
  },
};

const OPTIONAL_CREDENTIAL_FIELDS = new Set(['accountId']);
const PROVIDER_CONTROLS_PRICE = new Set<HtmlMembershipCommerceProvider>([
  'stripe',
  'hotmart',
  'ticto',
]);
const PROVIDER_USES_OFFER_CODE = new Set<HtmlMembershipCommerceProvider>([
  'hotmart',
  'ticto',
]);

const SALE_STATUSES = [
  ['paid', 'Paga'],
  ['pending', 'Pendente'],
  ['refunded', 'Reembolsada'],
  ['failed', 'Falhou'],
  ['canceled', 'Cancelada'],
  ['chargeback', 'Chargeback'],
  ['expired', 'Expirada'],
  ['unlinked', 'Não vinculada'],
] as const;

const SUBSCRIPTION_STATUSES = [
  ['pending', 'Pendente'],
  ['active', 'Ativa'],
  ['trialing', 'Em teste'],
  ['past_due', 'Pagamento atrasado'],
  ['paused', 'Pausada'],
  ['canceled', 'Cancelada'],
  ['expired', 'Expirada'],
] as const;

interface ConnectionDraft {
  id: string | number | null;
  provider: HtmlMembershipCommerceProvider;
  name: string;
  enabled: boolean;
  environment: HtmlMembershipCommerceEnvironment;
  credentials: Record<string, string>;
  clearCredentials: string[];
}

interface MappingDraft {
  id: string | number | null;
  connectionId: string;
  planId: string;
  externalProductId: string;
  externalPriceId: string;
  mode: HtmlMembershipPurchaseMode;
  currency: string;
  amount: number | null;
  status: 'active' | 'paused';
}

interface CheckoutDraft {
  mappingId: string;
  successUrl: string;
  cancelUrl: string;
  memberId: string;
  customerEmail: string;
  clientReference: string;
}

const EMPTY_CONNECTION: ConnectionDraft = {
  id: null,
  provider: 'stripe',
  name: '',
  enabled: true,
  environment: 'production',
  credentials: {},
  clearCredentials: [],
};

const EMPTY_MAPPING: MappingDraft = {
  id: null,
  connectionId: '',
  planId: '',
  externalProductId: '',
  externalPriceId: '',
  mode: 'payment',
  currency: 'BRL',
  amount: null,
  status: 'active',
};

function errorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return '';
  return error instanceof Error ? error.message : 'Não foi possível concluir esta operação.';
}

function formatDate(value: string) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString(getAdminUiLocale(), { dateStyle: 'short', timeStyle: 'short' });
}

function formatMoney(amount: number | null, currency: string) {
  if (amount === null || !currency) return '—';
  try {
    return getAdminNumberFormatter({
      style: 'currency',
      currency,
    }).format(amount / 100);
  } catch {
    return `${currency} ${(amount / 100).toFixed(2)}`;
  }
}

function statusTone(status: string) {
  if (['connected', 'paid', 'active', 'trialing', 'granted'].includes(status)) {
    return 'border-emerald-500/15 bg-emerald-500/10 text-emerald-300';
  }
  if (['pending', 'past_due', 'paused', 'expired'].includes(status)) {
    return 'border-amber-500/15 bg-amber-500/10 text-amber-200';
  }
  if (['error', 'failed', 'chargeback', 'revoked'].includes(status)) {
    return 'border-red-500/15 bg-red-500/10 text-red-200';
  }
  return 'border-white/[0.09] bg-white/[0.035] text-muted-foreground';
}

function statusLabel(status: string, subscriptions = false) {
  const values = subscriptions ? SUBSCRIPTION_STATUSES : SALE_STATUSES;
  return values.find(([key]) => key === status)?.[1]
    || status.replaceAll('_', ' ')
    || 'Desconhecido';
}

function connectionStatusLabel(status: HtmlMembershipCommerceConnection['status']) {
  if (status === 'connected') return 'Conectado';
  if (status === 'pending') return 'Verificação pendente';
  if (status === 'error') return 'Erro';
  if (status === 'expired') return 'Expirada';
  return 'Desconectada';
}

function connectionPurchaseModes(
  connection: HtmlMembershipCommerceConnection | undefined,
): HtmlMembershipPurchaseMode[] {
  if (!connection) return ['payment', 'subscription'];
  const declared = connection.capabilities.oneTime || connection.capabilities.subscriptions;
  if (!declared) return ['payment', 'subscription'];
  return [
    ...(connection.capabilities.oneTime ? ['payment' as const] : []),
    ...(connection.capabilities.subscriptions ? ['subscription' as const] : []),
  ];
}

async function copyLink(value: string, label: string) {
  if (!value) {
    toast.error('Nenhum link está disponível para esta ação.');
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copiado.`);
  } catch {
    toast.error('O navegador não permitiu copiar o link.');
  }
}

function Pagination({
  loading,
  page,
  total,
  totalPages,
  onPageChange,
}: {
  loading: boolean;
  page: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-white/[0.07] px-3 py-2">
      <span className="text-[9px] text-muted-foreground">
        {total.toLocaleString(getAdminUiLocale())} {total === 1 ? 'registro' : 'registros'}
      </span>
      <div className="flex items-center gap-1">
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Página anterior"
          disabled={page <= 1 || loading}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        ><ChevronLeft /></Button>
        <span className="min-w-16 text-center text-[9px] text-muted-foreground">
          {page} / {totalPages}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Próxima página"
          disabled={page >= totalPages || loading}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        ><ChevronRight /></Button>
      </div>
    </div>
  );
}

function CommerceMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Cable;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.018] p-3">
      <span className="flex items-center gap-2 text-[9px] text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </span>
      <strong className="mt-2 block text-xl font-semibold">{value.toLocaleString(getAdminUiLocale())}</strong>
    </div>
  );
}

export interface HtmlMembersCommerceProps {
  dataSource: HtmlMembershipDataSource;
  plans: readonly HtmlMembershipPlan[];
  canManage: boolean;
  canManageMembers: boolean;
  onManageMember: (id: string | number) => void | Promise<void>;
  onUseMappingAsUpgrade: (mapping: HtmlMembershipCommerceMapping) => void | Promise<void>;
}

export function HtmlMembersCommerce({
  dataSource,
  plans,
  canManage,
  canManageMembers,
  onManageMember,
  onUseMappingAsUpgrade,
}: HtmlMembersCommerceProps) {
  const onboardingActive = useBuilderOnboardingActive();
  const [section, setSection] = useState<CommerceSection>('checkout');
  const [overview, setOverview] = useState<HtmlMembershipCommerceOverview | null>(null);
  const [connections, setConnections] = useState<HtmlMembershipCommerceConnection[]>([]);
  const [mappings, setMappings] = useState<HtmlMembershipCommerceMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft | null>(null);
  const [connectionSaving, setConnectionSaving] = useState(false);
  const [connectionTesting, setConnectionTesting] = useState<string | number | null>(null);
  const [disconnecting, setDisconnecting] = useState<HtmlMembershipCommerceConnection | null>(null);

  const [mappingDraft, setMappingDraft] = useState<MappingDraft | null>(null);
  const [mappingSaving, setMappingSaving] = useState(false);
  const [products, setProducts] = useState<HtmlMembershipCommerceProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState('');
  const [deleteMapping, setDeleteMapping] = useState<HtmlMembershipCommerceMapping | null>(null);

  const [checkoutDraft, setCheckoutDraft] = useState<CheckoutDraft | null>(null);
  const [checkoutCreating, setCheckoutCreating] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<({
    title: string;
    description: string;
    allowOpen?: boolean;
  } & HtmlMembershipEphemeralLink) | null>(null);

  const [sales, setSales] = useState<HtmlMembershipCommerceRecord[]>([]);
  const [salesPage, setSalesPage] = useState(1);
  const [salesTotal, setSalesTotal] = useState(0);
  const [salesTotalPages, setSalesTotalPages] = useState(1);
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesError, setSalesError] = useState('');
  const [saleStatus, setSaleStatus] = useState('');
  const [saleProvider, setSaleProvider] = useState('');

  const [subscriptions, setSubscriptions] = useState<HtmlMembershipCommerceSubscription[]>([]);
  const [subscriptionPage, setSubscriptionPage] = useState(1);
  const [subscriptionTotal, setSubscriptionTotal] = useState(0);
  const [subscriptionTotalPages, setSubscriptionTotalPages] = useState(1);
  const [subscriptionsLoading, setSubscriptionsLoading] = useState(false);
  const [subscriptionsError, setSubscriptionsError] = useState('');
  const [subscriptionStatus, setSubscriptionStatus] = useState('');
  const [subscriptionProvider, setSubscriptionProvider] = useState('');
  const [portalLoading, setPortalLoading] = useState<string | number | null>(null);

  const availableProviders = useMemo(() => {
    const values = new Map(
      overview?.providers.map(provider => [provider.id, provider]) || [],
    );
    return values;
  }, [overview]);

  const reload = useCallback(async (signal?: AbortSignal) => {
    if (
      !dataSource.loadCommerceOverview
      || !dataSource.loadCommerceConnections
      || !dataSource.loadCommerceMappings
    ) return;
    setLoading(true);
    setLoadError('');
    const results = await Promise.allSettled([
      dataSource.loadCommerceOverview(signal),
      dataSource.loadCommerceConnections(signal),
      dataSource.loadCommerceMappings(signal),
    ]);
    if (signal?.aborted) return;
    const [overviewResult, connectionsResult, mappingsResult] = results;
    if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value);
    if (connectionsResult.status === 'fulfilled') setConnections(connectionsResult.value);
    if (mappingsResult.status === 'fulfilled') setMappings(mappingsResult.value);
    const firstError = results.find(result => result.status === 'rejected');
    if (firstError?.status === 'rejected') setLoadError(errorMessage(firstError.reason));
    setLoading(false);
  }, [dataSource]);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [refresh, reload]);

  useEffect(() => {
    if (section !== 'sales' || !dataSource.loadCommerceSales) return;
    const controller = new AbortController();
    setSalesLoading(true);
    setSalesError('');
    void dataSource.loadCommerceSales({
      page: salesPage,
      perPage: 20,
      status: saleStatus,
      provider: saleProvider as '' | HtmlMembershipCommerceProvider,
      signal: controller.signal,
    }).then(result => {
      setSales(result.items);
      setSalesTotal(result.total);
      setSalesTotalPages(result.totalPages);
    }).catch(error => {
      const message = errorMessage(error);
      if (message) setSalesError(message);
    }).finally(() => {
      if (!controller.signal.aborted) setSalesLoading(false);
    });
    return () => controller.abort();
  }, [dataSource, refresh, saleProvider, saleStatus, salesPage, section]);

  useEffect(() => {
    if (section !== 'subscriptions' || !dataSource.loadCommerceSubscriptions) return;
    const controller = new AbortController();
    setSubscriptionsLoading(true);
    setSubscriptionsError('');
    void dataSource.loadCommerceSubscriptions({
      page: subscriptionPage,
      perPage: 20,
      status: subscriptionStatus,
      provider: subscriptionProvider as '' | HtmlMembershipCommerceProvider,
      signal: controller.signal,
    }).then(result => {
      setSubscriptions(result.items);
      setSubscriptionTotal(result.total);
      setSubscriptionTotalPages(result.totalPages);
    }).catch(error => {
      const message = errorMessage(error);
      if (message) setSubscriptionsError(message);
    }).finally(() => {
      if (!controller.signal.aborted) setSubscriptionsLoading(false);
    });
    return () => controller.abort();
  }, [
    dataSource,
    refresh,
    section,
    subscriptionPage,
    subscriptionProvider,
    subscriptionStatus,
  ]);

  useEffect(() => {
    setSalesPage(1);
  }, [saleProvider, saleStatus]);

  useEffect(() => {
    setSubscriptionPage(1);
  }, [subscriptionProvider, subscriptionStatus]);

  useEffect(() => {
    if (!mappingDraft?.connectionId || !dataSource.loadCommerceProducts) {
      setProducts([]);
      setProductsError('');
      return;
    }
    const controller = new AbortController();
    setProductsLoading(true);
    setProductsError('');
    void dataSource.loadCommerceProducts(mappingDraft.connectionId, controller.signal)
      .then(setProducts)
      .catch(error => {
        const message = errorMessage(error);
        if (message) setProductsError(message);
        setProducts([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setProductsLoading(false);
      });
    return () => controller.abort();
  }, [dataSource, mappingDraft?.connectionId]);

  const openNewConnection = (provider: HtmlMembershipCommerceProvider) => {
    setConnectionDraft({
      ...EMPTY_CONNECTION,
      provider,
      name: PROVIDERS[provider].label,
      credentials: {},
      clearCredentials: [],
    });
  };

  const openConnectionEditor = (connection: HtmlMembershipCommerceConnection) => {
    setConnectionDraft({
      id: connection.id,
      provider: connection.provider,
      name: connection.name,
      enabled: connection.enabled,
      environment: connection.environment,
      credentials: {},
      clearCredentials: [],
    });
  };

  const saveConnection = async () => {
    if (
      !connectionDraft
      || !dataSource.createCommerceConnection
      || !dataSource.updateCommerceConnection
    ) return;
    const pagBankEmail = connectionDraft.credentials.accountEmail?.trim() || '';
    if (
      connectionDraft.provider === 'pagbank'
      && connectionDraft.enabled
      && (
        (connectionDraft.id === null && !pagBankEmail)
        || (pagBankEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pagBankEmail))
      )
    ) {
      toast.error(
        'Informe o e-mail da conta PagBank. Ele é necessário para reconciliar '
          + 'estornos, cancelamentos e disputas do fluxo legado.',
      );
      return;
    }
    const credentials: Record<string, string> = Object.fromEntries(
      Object.entries(connectionDraft.credentials)
        .map(([key, value]) => [key, value.trim()])
        .filter(([, value]) => Boolean(value)),
    );
    for (const key of connectionDraft.clearCredentials) credentials[key] = '';
    const input: SaveHtmlMembershipCommerceConnectionInput = {
      provider: connectionDraft.provider,
      name: connectionDraft.name.trim() || PROVIDERS[connectionDraft.provider].label,
      enabled: connectionDraft.enabled,
      ...(Object.keys(credentials).length ? { credentials } : {}),
      settings: { environment: connectionDraft.environment },
    };
    setConnectionSaving(true);
    try {
      const saved = connectionDraft.id === null
        ? await dataSource.createCommerceConnection(input)
        : await dataSource.updateCommerceConnection(connectionDraft.id, input);
      setConnectionDraft(null);
      setRefresh(value => value + 1);
      toast.success(connectionDraft.id === null
        ? 'Conexão salva. A verificação acontece no teste ou no primeiro checkout.'
        : 'Conexão atualizada.');
      if (saved.connectUrl) {
        setGeneratedLink({
          title: `Autorizar ${PROVIDERS[saved.provider].label}`,
          description: 'Conclua a autorização diretamente no provedor. O Kodety não recebe sua senha financeira.',
          url: saved.connectUrl,
          expiresAt: '',
        });
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setConnectionSaving(false);
    }
  };

  const testConnection = async (connection: HtmlMembershipCommerceConnection) => {
    if (!dataSource.testCommerceConnection) return;
    setConnectionTesting(connection.id);
    try {
      const tested = await dataSource.testCommerceConnection(connection.id);
      toast.success(tested.status === 'connected'
        ? 'Conexão confirmada pelo provedor.'
        : `Teste concluído com status: ${tested.status}.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      // Provider failures are persisted as connection status/error by WordPress.
      setRefresh(value => value + 1);
      setConnectionTesting(null);
    }
  };

  const removeConnection = async () => {
    if (!disconnecting || !dataSource.deleteCommerceConnection) return;
    await dataSource.deleteCommerceConnection(disconnecting.id);
    setDisconnecting(null);
    setRefresh(value => value + 1);
    toast.success('Conexão nunca usada removida.');
  };

  const selectProduct = (productId: string) => {
    const product = products.find(item => item.id === productId);
    if (!product) {
      setMappingDraft(current => current ? {
        ...current,
        externalProductId: productId === '__manual' ? '' : productId,
        externalPriceId: '',
      } : current);
      return;
    }
    const firstPrice = product.prices.find(price => price.active) || product.prices[0];
    setMappingDraft(current => {
      if (!current) return current;
      const connection = connections.find(item => String(item.id) === current.connectionId);
      const modes = connectionPurchaseModes(connection);
      const selectedMode = firstPrice?.mode || product.mode;
      return {
        ...current,
        externalProductId: product.id,
        externalPriceId: firstPrice?.id || '',
        mode: current.id !== null
          ? current.mode
          : modes.includes(selectedMode) ? selectedMode : modes[0],
        currency: firstPrice?.currency || current.currency || 'BRL',
        amount: firstPrice?.amount ?? current.amount,
      };
    });
  };

  const selectPrice = (priceId: string) => {
    const price = products
      .flatMap(product => product.prices)
      .find(item => item.id === priceId);
    setMappingDraft(current => {
      if (!current) return current;
      const connection = connections.find(item => String(item.id) === current.connectionId);
      const modes = connectionPurchaseModes(connection);
      return {
        ...current,
        externalPriceId: priceId === '__none' ? '' : priceId,
        mode: current.id === null && price && modes.includes(price.mode)
          ? price.mode
          : current.mode,
        currency: price?.currency || current.currency,
        amount: price?.amount ?? current.amount,
      };
    });
  };

  const openMappingEditor = (mapping: HtmlMembershipCommerceMapping) => {
    setMappingDraft({
      id: mapping.id,
      connectionId: String(mapping.connectionId),
      planId: String(mapping.planId),
      externalProductId: mapping.externalProductId,
      externalPriceId: mapping.externalPriceId,
      mode: mapping.mode,
      currency: mapping.currency || 'BRL',
      amount: mapping.amount,
      status: mapping.status === 'active' ? 'active' : 'paused',
    });
  };

  const saveMapping = async () => {
    if (
      !mappingDraft
      || !dataSource.createCommerceMapping
      || (mappingDraft.id !== null && !dataSource.updateCommerceMapping)
    ) return;
    if (!mappingDraft.connectionId || !mappingDraft.planId) {
      toast.error('Selecione a conexão e o plano Kodety.');
      return;
    }
    const connection = connections.find(item => String(item.id) === mappingDraft.connectionId);
    if (!connection) {
      toast.error('A conexão selecionada não está mais disponível.');
      return;
    }
    const productId = mappingDraft.externalProductId.trim();
    const priceId = mappingDraft.externalPriceId.trim();
    if (connection.provider === 'stripe' && !priceId) {
      toast.error('A Stripe exige o ID do preço para criar Checkout Sessions com valor autoritativo.');
      return;
    }
    if (PROVIDER_USES_OFFER_CODE.has(connection.provider) && !priceId) {
      toast.error(`${PROVIDERS[connection.provider].label} exige o código da oferta de checkout.`);
      return;
    }
    if (
      mappingDraft.mode === 'subscription'
      && ['pagarme', 'iugu'].includes(connection.provider)
      && !productId
    ) {
      toast.error(`${PROVIDERS[connection.provider].label} exige o identificador do plano para recorrência.`);
      return;
    }
    if (
      !PROVIDER_CONTROLS_PRICE.has(connection.provider)
      && (!(mappingDraft.amount && mappingDraft.amount > 0) || !mappingDraft.currency)
    ) {
      toast.error(`${PROVIDERS[connection.provider].label} exige um valor maior que zero e a moeda.`);
      return;
    }
    setMappingSaving(true);
    try {
      if (mappingDraft.id === null) {
        await dataSource.createCommerceMapping({
          connectionId: mappingDraft.connectionId,
          planId: mappingDraft.planId,
          externalProductId: productId || undefined,
          externalPriceId: priceId || undefined,
          mode: mappingDraft.mode,
          currency: mappingDraft.currency || undefined,
          amount: mappingDraft.amount,
        });
      } else {
        await dataSource.updateCommerceMapping?.(mappingDraft.id, {
          // Empty strings intentionally clear values through PATCH. Omitting
          // them would make WordPress retain the previous external identity.
          externalProductId: productId,
          externalPriceId: priceId,
          currency: mappingDraft.currency || undefined,
          amount: mappingDraft.amount,
          status: mappingDraft.status,
        });
      }
      setMappingDraft(null);
      setRefresh(value => value + 1);
      toast.success(mappingDraft.id === null
        ? 'Plano ligado ao produto do provedor.'
        : 'Mapeamento atualizado.');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setMappingSaving(false);
    }
  };

  const removeMapping = async () => {
    if (!deleteMapping || !dataSource.deleteCommerceMapping) return;
    await dataSource.deleteCommerceMapping(deleteMapping.id);
    setDeleteMapping(null);
    setRefresh(value => value + 1);
    toast.success('Mapeamento removido. O plano e o histórico permanecem intactos.');
  };

  const handlePermanentLink = async (mapping: HtmlMembershipCommerceMapping) => {
    if (!mapping.publicUrl) return;
    if (htmlMembershipCommerceSupportsAnonymousCheckoutHref(
      mapping.provider,
      mapping.publicUrl,
    )) {
      await copyLink(mapping.publicUrl, 'Link de venda');
      return;
    }
    const providerLabel = PROVIDERS[mapping.provider].label;
    setGeneratedLink({
      title: `Link incompatível · ${providerLabel}`,
      description: 'O WordPress não retornou a landing pública versionada deste mapeamento. Atualize o catálogo antes de publicar; uma URL antiga ou temporária não deve ser usada em LPs.',
      url: mapping.publicUrl,
      expiresAt: '',
      allowOpen: false,
    });
  };

  const openCheckoutPreview = (mapping: HtmlMembershipCommerceMapping) => {
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    setCheckoutDraft({
      mappingId: String(mapping.id),
      successUrl: `${origin}/obrigado/`,
      cancelUrl: `${origin}/planos/`,
      memberId: '',
      customerEmail: '',
      clientReference: '',
    });
  };

  const createCheckoutPreview = async () => {
    if (!checkoutDraft || !dataSource.createCheckoutLink) return;
    const mapping = mappings.find(item => String(item.id) === checkoutDraft.mappingId);
    if (!mapping) {
      toast.error('Selecione um mapeamento válido.');
      return;
    }
    const typedEmail = checkoutDraft.customerEmail.trim();
    const memberId = checkoutDraft.memberId.trim();
    const typedEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typedEmail);
    if (memberId && !/^[1-9]\d*$/.test(memberId)) {
      toast.error('O ID do membro precisa ser um número positivo.');
      return;
    }
    if (typedEmail && !typedEmailValid) {
      toast.error('Informe um e-mail válido ou deixe o campo vazio.');
      return;
    }
    if (
      htmlMembershipCommerceRequiresCustomerEmail(mapping.provider)
      && !typedEmail
      && !memberId
    ) {
      toast.error(
        mapping.provider === 'iugu'
          ? 'A Iugu exige um e-mail válido para criar a fatura hospedada.'
          : 'A Woovi exige um e-mail válido no Kodety para associar o Pix ao acesso do membro.',
      );
      return;
    }
    setCheckoutCreating(true);
    try {
      let customerEmail = typedEmail;
      let userId: string | number | undefined;
      if (memberId) {
        if (!dataSource.loadMember) {
          throw new Error('Este host não permite validar o membro selecionado.');
        }
        const member = await dataSource.loadMember(memberId);
        if (!member.email) {
          throw new Error('O membro selecionado não possui um e-mail válido.');
        }
        if (
          customerEmail
          && customerEmail.toLocaleLowerCase() !== member.email.toLocaleLowerCase()
        ) {
          throw new Error('O e-mail informado não pertence ao ID de membro selecionado.');
        }
        userId = member.id;
        customerEmail = member.email;
      }
      if (
        htmlMembershipCommerceRequiresCustomerEmail(mapping.provider)
        && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)
      ) {
        throw new Error('Este provedor exige um e-mail válido para criar o checkout.');
      }
      const link = await dataSource.createCheckoutLink({
        connectionId: mapping.connectionId,
        planId: mapping.planId,
        ...(userId !== undefined ? { userId } : {}),
        mode: mapping.mode,
        successUrl: checkoutDraft.successUrl.trim(),
        cancelUrl: checkoutDraft.cancelUrl.trim(),
        ...(customerEmail
          ? { customerEmail }
          : {}),
        ...(checkoutDraft.clientReference.trim()
          ? { clientReference: checkoutDraft.clientReference.trim() }
          : {}),
      });
      setCheckoutDraft(null);
      setGeneratedLink({
        title: 'Checkout temporário criado',
        description: htmlMembershipCommerceRequiresCustomerEmail(mapping.provider)
          ? `Use este link para atendimento individual. Em páginas públicas, use a landing permanente do Kodety, que captura e verifica o e-mail antes de abrir ${PROVIDERS[mapping.provider].label}.`
          : 'Use este link apenas para prévia ou atendimento individual. Para páginas, use o link de venda permanente do mapeamento.',
        url: link.url,
        expiresAt: link.expiresAt,
      });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setCheckoutCreating(false);
    }
  };

  const openPortal = async (subscription: HtmlMembershipCommerceSubscription) => {
    if (!dataSource.createSubscriptionPortalLink) return;
    setPortalLoading(subscription.id);
    try {
      const link = await dataSource.createSubscriptionPortalLink(subscription.id);
      setGeneratedLink({
        title: 'Portal do assinante',
        description: 'Este link temporário abre a gestão da assinatura no próprio provedor.',
        ...link,
      });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPortalLoading(null);
    }
  };

  const syncCommerce = async () => {
    if (!canManage || !dataSource.syncCommerce) return;
    setSyncing(true);
    try {
      const result = await dataSource.syncCommerce(25);
      setRefresh(value => value + 1);
      const recovered = result.staleEventsRecovered
        ? ` · ${result.staleEventsRecovered} evento(s) recuperado(s)`
        : '';
      toast.success(
        `Sincronização concluída: ${result.checked} verificado(s), `
          + `${result.projected} atualizado(s), ${result.failed} falha(s)${recovered}.`,
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSyncing(false);
    }
  };

  const mappableConnections = connections.filter(
    htmlMembershipCommerceConnectionCanCreateMapping,
  );
  const activePlans = plans.filter(plan => plan.status === 'active');
  const selectedMappingConnection = mappingDraft
    ? connections.find(connection => String(connection.id) === mappingDraft.connectionId)
    : undefined;
  const selectedPurchaseModes = connectionPurchaseModes(selectedMappingConnection);
  const selectedCheckoutMapping = checkoutDraft
    ? mappings.find(mapping => String(mapping.id) === checkoutDraft.mappingId)
    : undefined;

  const checkoutSection = (
    <div className="grid gap-5">
      <section data-kodety-onboarding="members-commerce-providers" className="grid gap-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xs font-semibold">Provedores de checkout</h3>
            <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
              Credenciais são enviadas diretamente ao WordPress e nunca voltam para o navegador.
            </p>
          </div>
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label="Atualizar integrações"
            disabled={loading}
            onClick={() => setRefresh(value => value + 1)}
          ><RefreshCw className={loading ? 'animate-spin' : ''} /></Button>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {HTML_MEMBERSHIP_COMMERCE_PROVIDERS.map(provider => {
            const definition = PROVIDERS[provider];
            const providerConnections = connections.filter(item => item.provider === provider);
            const availability = availableProviders.get(provider);
            const available = availability?.available !== false;
            return (
              <article key={provider} className="rounded-xl border border-white/[0.08] bg-white/[0.012] p-3">
                <div className="flex items-start gap-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--kodety-accent)]/10 text-[var(--kodety-accent-hover)]">
                    <WalletCards className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <strong className="text-[11px]">{definition.label}</strong>
                      {!available && <Badge variant="outline" className="text-[7px]">Indisponível</Badge>}
                    </span>
                    <span className="mt-0.5 block text-[8px] leading-3 text-muted-foreground">
                      {definition.description}
                    </span>
                  </span>
                </div>
                <div className="mt-3 grid gap-1.5">
                  {providerConnections.map(connection => (
                    <div key={String(connection.id)} className="rounded-lg border border-white/[0.07] bg-black/10 p-2">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className={cn('text-[7px]', statusTone(connection.status))}>
                          {connectionStatusLabel(connection.status)}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate text-[8px]">{connection.name}</span>
                        <Badge variant="outline" className="text-[7px]">
                          {connection.environment === 'sandbox' ? 'Teste' : 'Produção'}
                        </Badge>
                      </div>
                      {connection.errorMessage && (
                        <p className="mt-1 text-[8px] leading-3 text-red-200">{connection.errorMessage}</p>
                      )}
                      {(connection.lastVerifiedAt || connection.lastSyncedAt) && (
                        <p className="mt-1 text-[7px] leading-3 text-muted-foreground">
                          {connection.lastVerifiedAt
                            ? `Verificada ${formatDate(connection.lastVerifiedAt)}`
                            : 'Sem verificação read-only'}
                          {connection.lastSyncedAt
                            ? ` · Sincronizada ${formatDate(connection.lastSyncedAt)}`
                            : ''}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {connection.provider === 'pagbank' ? (
                          <span className="inline-flex items-center px-2 text-[7px] text-amber-200">
                            Sem teste read-only
                          </span>
                        ) : (
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={!canManage || connectionTesting === connection.id}
                            onClick={() => void testConnection(connection)}
                          >
                            {connectionTesting === connection.id
                              ? <Loader2 className="animate-spin" />
                              : <RotateCw />}
                            Testar
                          </Button>
                        )}
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={!canManage}
                          onClick={() => openConnectionEditor(connection)}
                        ><Pencil /> Configurar</Button>
                        {connection.dashboardUrl && (
                          <Button size="xs" variant="ghost" asChild>
                            <a href={connection.dashboardUrl} target="_blank" rel="noreferrer">
                              <ExternalLink /> Painel
                            </a>
                          </Button>
                        )}
                        {connection.webhookUrl && (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => void copyLink(connection.webhookUrl, 'URL confidencial do webhook')}
                          ><Clipboard /> Webhook</Button>
                        )}
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          disabled={!canManage}
                          aria-label={`Remover conexão ${connection.name}`}
                          onClick={() => setDisconnecting(connection)}
                        ><Trash2 /></Button>
                      </div>
                      {connection.webhookUrl && (
                        <details className="group mt-2 rounded-md border border-amber-500/15 bg-amber-500/[0.045] px-2 py-1.5 text-[7px] leading-3 text-amber-100/80">
                          <DisclosureSummary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-amber-100">
                            <span>Webhook manual · fase 1</span>
                          </DisclosureSummary>
                          <p className="mt-1">
                            Cadastre a URL copiada no painel de {definition.label}.
                            {' '}Eventos mínimos: {definition.webhookEvents}.
                          </p>
                        </details>
                      )}
                    </div>
                  ))}
                  {!providerConnections.length && (
                    <Button
                      variant="secondary"
                      disabled={!canManage || !available}
                      onClick={() => openNewConnection(provider)}
                    ><Plug /> Conectar {definition.label}</Button>
                  )}
                  {providerConnections.length > 0 && (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={!canManage || !available}
                      onClick={() => openNewConnection(provider)}
                    ><Plug /> Adicionar conexão</Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section data-kodety-onboarding="members-commerce-mappings" className="grid gap-3 border-t border-white/[0.07] pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xs font-semibold">Planos e produtos</h3>
            <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
              O link de venda é permanente: a sessão hospedada é criada no provedor a cada clique.
              A landing coleta e verifica o e-mail antes de abrir o provedor; isso também torna Iugu e Woovi seguras para visitantes.
            </p>
          </div>
          <Button
            disabled={!canManage || !mappableConnections.length || !activePlans.length}
            onClick={() => setMappingDraft({
              ...EMPTY_MAPPING,
              connectionId: mappableConnections.length === 1
                ? String(mappableConnections[0].id)
                : '',
              planId: activePlans.length === 1 ? String(activePlans[0].id) : '',
            })}
          ><Link2 /> Mapear plano</Button>
        </div>
        {!mappings.length ? (
          <div className="rounded-xl border border-dashed border-white/[0.1] p-6 text-center">
            <Link2 className="mx-auto size-5 text-muted-foreground" />
            <h4 className="mt-2 text-[11px] font-medium">Nenhum plano ligado a checkout</h4>
            <p className="mx-auto mt-1 max-w-lg text-[9px] leading-4 text-muted-foreground">
              Conecte um provedor e associe cada plano a um produto ou preço externo.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/[0.08]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[840px] border-collapse text-left">
                <thead className="bg-white/[0.025] text-[8px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">Plano</th>
                    <th className="px-3 py-2.5 font-medium">Provedor</th>
                    <th className="px-3 py-2.5 font-medium">Produto / preço</th>
                    <th className="px-3 py-2.5 font-medium">Modalidade</th>
                    <th className="px-3 py-2.5 font-medium">Valor</th>
                    <th className="w-72 px-3 py-2.5 font-medium"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.065]">
                  {mappings.map(mapping => (
                    <tr key={String(mapping.id)} className="bg-white/[0.008]">
                      <td className="px-3 py-2.5">
                        <span className="block text-[10px] font-medium">
                          {mapping.planName || plans.find(plan => String(plan.id) === String(mapping.planId))?.name || mapping.planKey}
                        </span>
                        <span className="flex flex-wrap items-center gap-1">
                          <span className="font-mono text-[8px] text-muted-foreground">{mapping.planKey}</span>
                          {mapping.status !== 'active' && (
                            <Badge variant="outline" className="border-amber-500/15 bg-amber-500/[0.06] text-[7px] text-amber-200">
                              Pausado
                            </Badge>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-[9px]">
                        <span className="block">{PROVIDERS[mapping.provider].label}</span>
                        {htmlMembershipCommerceRequiresCustomerEmail(mapping.provider) && (
                          <span className="block text-[7px] text-emerald-200">Landing captura e verifica e-mail</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="block max-w-48 truncate font-mono text-[8px]">{mapping.externalProductId}</span>
                        {mapping.externalPriceId && <span className="block max-w-48 truncate font-mono text-[8px] text-muted-foreground">{mapping.externalPriceId}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-[9px]">
                        {mapping.mode === 'subscription' ? 'Assinatura' : 'Venda única'}
                      </td>
                      <td className="px-3 py-2.5 text-[9px]">{formatMoney(mapping.amount, mapping.currency)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="xs"
                            variant="secondary"
                            disabled={mapping.status !== 'active' || !mapping.publicUrl}
                            onClick={() => void handlePermanentLink(mapping)}
                          >
                            {htmlMembershipCommerceSupportsAnonymousCheckoutHref(
                              mapping.provider,
                              mapping.publicUrl,
                            ) ? <Clipboard /> : <AlertTriangle />}
                            {htmlMembershipCommerceSupportsAnonymousCheckoutHref(
                              mapping.provider,
                              mapping.publicUrl,
                            ) ? 'Copiar link de venda' : 'Ver incompatibilidade'}
                          </Button>
                          {mapping.status === 'active'
                            && htmlMembershipCommerceSupportsAnonymousCheckoutHref(
                              mapping.provider,
                              mapping.publicUrl,
                            ) && (
                            <Button size="xs" variant="ghost" asChild>
                              <a
                                href={mapping.publicUrl}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Abrir landing de checkout de ${mapping.planName || mapping.planKey}`}
                              >
                                <ExternalLink /> Abrir
                              </a>
                            </Button>
                          )}
                          <Button
                            size="xs"
                            variant="ghost"
                            title={!htmlMembershipCommerceSupportsAnonymousCheckoutHref(
                              mapping.provider,
                              mapping.publicUrl,
                            )
                              ? 'Este mapeamento ainda não possui a landing pública versionada.'
                              : undefined}
                            disabled={!canManage
                              || mapping.status !== 'active'
                              || !mapping.publicUrl
                              || !htmlMembershipCommerceSupportsAnonymousCheckoutHref(
                                mapping.provider,
                                mapping.publicUrl,
                              )}
                            onClick={() => void onUseMappingAsUpgrade(mapping)}
                          ><Link2 /> Usar no upgrade</Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={!canManage
                              || mapping.status !== 'active'
                              || !dataSource.createCheckoutLink}
                            onClick={() => openCheckoutPreview(mapping)}
                          ><ShoppingCart /> Prévia</Button>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            disabled={!canManage || !dataSource.updateCommerceMapping}
                            aria-label="Editar mapeamento"
                            onClick={() => openMappingEditor(mapping)}
                          ><Pencil /></Button>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            disabled={!canManage}
                            aria-label="Remover mapeamento"
                            onClick={() => setDeleteMapping(mapping)}
                          ><Trash2 /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );

  const salesSection = (
    <section data-kodety-onboarding="members-commerce-sales" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={saleProvider || '__all'} onValueChange={value => setSaleProvider(value === '__all' ? '' : value)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todos os provedores</SelectItem>
            {HTML_MEMBERSHIP_COMMERCE_PROVIDERS.map(provider => (
              <SelectItem key={provider} value={provider}>{PROVIDERS[provider].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={saleStatus || '__all'} onValueChange={value => setSaleStatus(value === '__all' ? '' : value)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todos os status</SelectItem>
            {SALE_STATUSES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Atualizar vendas"
          disabled={salesLoading}
          onClick={() => setRefresh(value => value + 1)}
        ><RefreshCw className={salesLoading ? 'animate-spin' : ''} /></Button>
      </div>
      {salesError ? (
        <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/[0.06] p-3 text-xs text-red-200">{salesError}</p>
      ) : salesLoading && !sales.length ? (
        <div className="grid min-h-56 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : !sales.length ? (
        <div className="rounded-xl border border-dashed border-white/[0.1] p-8 text-center text-[10px] text-muted-foreground">
          Nenhuma venda encontrada com estes filtros.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[0.08]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-left">
              <thead className="bg-white/[0.025] text-[8px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Membro</th>
                  <th className="px-3 py-2.5 font-medium">Plano</th>
                  <th className="px-3 py-2.5 font-medium">Provedor</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Valor da venda</th>
                  <th className="px-3 py-2.5 font-medium">Data</th>
                  <th className="w-32 px-3 py-2.5 font-medium"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.065]">
                {sales.map(sale => (
                  <tr key={String(sale.id)} className="bg-white/[0.008]">
                    <td className="px-3 py-2.5">
                      <span className="block text-[10px] font-medium">{sale.customerName || 'Não associado'}</span>
                      <span className="block text-[8px] text-muted-foreground">{sale.customerEmail || 'Sem usuário WordPress associado'}</span>
                    </td>
                    <td className="px-3 py-2.5 text-[9px]">{sale.planName || sale.planKey || '—'}</td>
                    <td className="px-3 py-2.5 text-[9px]">{PROVIDERS[sale.provider].label}</td>
                    <td className="px-3 py-2.5">
                      <span className="grid justify-items-start gap-1">
                        <Badge variant="outline" className={cn('text-[7px]', statusTone(sale.status))}>
                          {statusLabel(sale.status)}
                        </Badge>
                        {sale.accessStatus && (
                          <span className="text-[7px] text-muted-foreground">
                            Acesso: {sale.accessStatus.replaceAll('_', ' ')}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[9px]">{formatMoney(sale.amount, sale.currency)}</td>
                    <td className="px-3 py-2.5 text-[8px] text-muted-foreground">
                      {formatDate(sale.occurredAt || sale.createdAt)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        {sale.userId !== null && (
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            disabled={!canManageMembers}
                            aria-label="Gerenciar acesso do membro"
                            onClick={() => void onManageMember(sale.userId as string | number)}
                          ><UserRoundCog /></Button>
                        )}
                        {sale.dashboardUrl && (
                          <Button size="icon-xs" variant="ghost" asChild>
                            <a href={sale.dashboardUrl} target="_blank" rel="noreferrer" aria-label="Abrir painel do provedor">
                              <ExternalLink />
                            </a>
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            loading={salesLoading}
            page={salesPage}
            total={salesTotal}
            totalPages={salesTotalPages}
            onPageChange={setSalesPage}
          />
        </div>
      )}
    </section>
  );

  const subscriptionsSection = (
    <section data-kodety-onboarding="members-commerce-subscriptions" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={subscriptionProvider || '__all'} onValueChange={value => setSubscriptionProvider(value === '__all' ? '' : value)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todos os provedores</SelectItem>
            {HTML_MEMBERSHIP_COMMERCE_PROVIDERS.map(provider => (
              <SelectItem key={provider} value={provider}>{PROVIDERS[provider].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={subscriptionStatus || '__all'} onValueChange={value => setSubscriptionStatus(value === '__all' ? '' : value)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todos os status</SelectItem>
            {SUBSCRIPTION_STATUSES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Atualizar assinaturas"
          disabled={subscriptionsLoading}
          onClick={() => setRefresh(value => value + 1)}
        ><RefreshCw className={subscriptionsLoading ? 'animate-spin' : ''} /></Button>
      </div>
      {subscriptionsError ? (
        <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/[0.06] p-3 text-xs text-red-200">{subscriptionsError}</p>
      ) : subscriptionsLoading && !subscriptions.length ? (
        <div className="grid min-h-56 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : !subscriptions.length ? (
        <div className="rounded-xl border border-dashed border-white/[0.1] p-8 text-center text-[10px] text-muted-foreground">
          Nenhuma assinatura encontrada com estes filtros.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[0.08]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead className="bg-white/[0.025] text-[8px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Membro</th>
                  <th className="px-3 py-2.5 font-medium">Plano</th>
                  <th className="px-3 py-2.5 font-medium">Provedor</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Período atual</th>
                  <th className="w-40 px-3 py-2.5 font-medium"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.065]">
                {subscriptions.map(subscription => (
                  <tr key={String(subscription.id)} className="bg-white/[0.008]">
                    <td className="px-3 py-2.5">
                      <span className="block text-[10px] font-medium">{subscription.customerName || 'Não associado'}</span>
                      <span className="block text-[8px] text-muted-foreground">{subscription.customerEmail || 'Sem usuário WordPress associado'}</span>
                    </td>
                    <td className="px-3 py-2.5 text-[9px]">{subscription.planName || subscription.planKey || '—'}</td>
                    <td className="px-3 py-2.5 text-[9px]">{PROVIDERS[subscription.provider].label}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className={cn('text-[7px]', statusTone(subscription.status))}>
                        {statusLabel(subscription.status, true)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-[8px] text-muted-foreground">
                      {subscription.currentPeriodEnd
                        ? `Até ${formatDate(subscription.currentPeriodEnd)}`
                        : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        {subscription.userId !== null && (
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            disabled={!canManageMembers}
                            aria-label="Gerenciar acesso do membro"
                            onClick={() => void onManageMember(subscription.userId as string | number)}
                          ><UserRoundCog /></Button>
                        )}
                        {subscription.portalAvailable && (
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={!canManage || portalLoading === subscription.id}
                            onClick={() => void openPortal(subscription)}
                          >
                            {portalLoading === subscription.id
                              ? <Loader2 className="animate-spin" />
                              : <ExternalLink />}
                            Portal
                          </Button>
                        )}
                        {subscription.dashboardUrl && (
                          <Button size="icon-xs" variant="ghost" asChild>
                            <a href={subscription.dashboardUrl} target="_blank" rel="noreferrer" aria-label="Abrir painel do provedor">
                              <ExternalLink />
                            </a>
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            loading={subscriptionsLoading}
            page={subscriptionPage}
            total={subscriptionTotal}
            totalPages={subscriptionTotalPages}
            onPageChange={setSubscriptionPage}
          />
        </div>
      )}
    </section>
  );

  return (
    <div data-kodety-onboarding="members-commerce-body" className="mx-auto grid w-full max-w-7xl gap-4">
      <div className="rounded-xl border border-[var(--kodety-accent)]/15 bg-[var(--kodety-accent)]/[0.055] p-3">
        <div className="flex flex-wrap items-start gap-2.5">
          <WalletCards className="mt-0.5 size-4 shrink-0 text-[var(--kodety-accent-hover)]" />
          <span className="min-w-0 flex-1">
            <strong className="block text-[10px] text-[var(--kodety-accent-hover)]">Financeiro no provedor</strong>
            <span className="mt-0.5 block text-[9px] leading-4 text-[var(--kodety-accent-hover)]/65">
              O Kodety exibe vendas e sincroniza acesso. Saldo, dados de cartão, liquidação,
              reembolso e disputa continuam exclusivamente no Stripe, Mercado Pago ou outro provedor conectado.
            </span>
          </span>
          {dataSource.syncCommerce && (
            <Button
              size="sm"
              variant="secondary"
              disabled={!canManage || syncing}
              onClick={() => void syncCommerce()}
            >
              <RefreshCw className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Sincronizando…' : 'Sincronizar agora'}
            </Button>
          )}
        </div>
      </div>

      {loadError && (
        <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/[0.06] p-3 text-xs text-red-200">
          {loadError}
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-4">
        <CommerceMetric icon={Cable} label="Conexões ativas" value={overview?.activeConnectionCount || connections.filter(item => item.status === 'connected').length} />
        <CommerceMetric icon={ReceiptText} label="Vendas registradas" value={overview?.saleCount || 0} />
        <CommerceMetric icon={CheckCircle2} label="Assinaturas ativas" value={overview?.activeSubscriptionCount || 0} />
        <CommerceMetric icon={Link2} label="Planos mapeados" value={mappings.length} />
      </div>

      {overview?.unlinkedSaleCount ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[9px] leading-4 text-amber-100">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {overview.unlinkedSaleCount.toLocaleString(getAdminUiLocale())} venda(s) ainda não foram associadas a um usuário WordPress.
          Nenhum acesso é liberado apenas por coincidência de e-mail.
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1 border-b border-white/[0.07] pb-2">
        {([
          ['checkout', 'Checkouts', ShoppingCart],
          ['sales', 'Vendas', ReceiptText],
          ['subscriptions', 'Assinaturas', RefreshCw],
        ] as const).map(([value, label, Icon]) => (
          <Button
            key={value}
            variant={section === value ? 'secondary' : 'ghost'}
            onClick={() => setSection(value)}
          ><Icon /> {label}</Button>
        ))}
      </div>

      {loading && !overview && !connections.length ? (
        <div className="grid min-h-64 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : section === 'checkout' ? checkoutSection : section === 'sales' ? salesSection : subscriptionsSection}

      <Dialog
        open={connectionDraft !== null}
        modal={!onboardingActive}
        onOpenChange={next => { if (!next && !connectionSaving) setConnectionDraft(null); }}
      >
        <DialogContent {...builderOnboardingDialogProps(onboardingActive)} data-kodety-onboarding-navigation-draft="member-commerce-connection" className="max-w-lg gap-0 overflow-hidden p-0">
          <DialogHeader className="m-0 border-b px-5 py-4">
            <DialogTitle>
              {connectionDraft?.id === null ? 'Conectar' : 'Configurar'}{' '}
              {connectionDraft ? PROVIDERS[connectionDraft.provider].label : 'provedor'}
            </DialogTitle>
            <DialogDescription>
              Use credenciais exclusivas. Campos secretos ficam vazios ao reabrir e nunca são retornados pelo WordPress.
            </DialogDescription>
          </DialogHeader>
          {connectionDraft && (
            <div data-kodety-onboarding="members-commerce-connection" className="grid max-h-[65vh] gap-4 overflow-y-auto p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <Label>Nome da conexão</Label>
                  <Input
                    value={connectionDraft.name}
                    onChange={event => setConnectionDraft(current => current ? { ...current, name: event.target.value } : current)}
                  />
                </label>
                <label className="grid gap-1.5">
                  <Label>Ambiente</Label>
                  <Select
                    value={connectionDraft.environment}
                    onValueChange={environment => setConnectionDraft(current => current ? {
                      ...current,
                      environment: environment as HtmlMembershipCommerceEnvironment,
                    } : current)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="production">Produção</SelectItem>
                      <SelectItem value="sandbox">Teste / sandbox</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <div className="grid gap-3">
                {PROVIDERS[connectionDraft.provider].credentialFields.map(field => {
                  const optional = OPTIONAL_CREDENTIAL_FIELDS.has(field.key);
                  const cleared = connectionDraft.clearCredentials.includes(field.key);
                  return (
                    <div key={field.key} className="grid gap-1.5">
                      <span className="flex items-center justify-between gap-2">
                        <Label>{field.label}</Label>
                        {connectionDraft.id !== null && optional && (
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            onClick={() => setConnectionDraft(current => {
                              if (!current) return current;
                              return {
                                ...current,
                                credentials: {
                                  ...current.credentials,
                                  [field.key]: '',
                                },
                                clearCredentials: cleared
                                  ? current.clearCredentials.filter(key => key !== field.key)
                                  : [...current.clearCredentials, field.key],
                              };
                            })}
                          >
                            {cleared ? 'Manter atual' : 'Remover valor'}
                          </Button>
                        )}
                      </span>
                      <Input
                        type={field.key === 'accountEmail' ? 'email' : 'password'}
                        autoComplete="new-password"
                        disabled={cleared}
                        value={connectionDraft.credentials[field.key] || ''}
                        placeholder={cleared
                          ? 'O valor será removido ao salvar'
                          : connectionDraft.id === null
                            ? field.placeholder
                            : 'Deixe vazio para manter o valor atual'}
                        onChange={event => setConnectionDraft(current => current ? {
                          ...current,
                          credentials: {
                            ...current.credentials,
                            [field.key]: event.target.value,
                          },
                          clearCredentials: current.clearCredentials.filter(
                            key => key !== field.key,
                          ),
                        } : current)}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.08] p-3">
                <span>
                  <Label>Conexão ativa</Label>
                  <span className="mt-0.5 block text-[9px] text-muted-foreground">
                    Desativar impede novos checkouts sem apagar histórico.
                  </span>
                </span>
                <Switch
                  checked={connectionDraft.enabled}
                  onCheckedChange={enabled => setConnectionDraft(current => current ? { ...current, enabled } : current)}
                />
              </div>
            </div>
          )}
          <DialogFooter className="border-t px-5 py-3">
            <Button variant="secondary" disabled={connectionSaving} onClick={() => setConnectionDraft(null)}>Cancelar</Button>
            <Button disabled={connectionSaving} onClick={() => void saveConnection()}>
              {connectionSaving ? <Loader2 className="animate-spin" /> : <Plug />}
              {connectionSaving ? 'Salvando…' : 'Salvar conexão'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={mappingDraft !== null}
        modal={!onboardingActive}
        onOpenChange={next => { if (!next && !mappingSaving) setMappingDraft(null); }}
      >
        <DialogContent {...builderOnboardingDialogProps(onboardingActive)} data-kodety-onboarding-navigation-draft="member-commerce-mapping" className="max-w-xl gap-0 overflow-hidden p-0">
          <DialogHeader className="m-0 border-b px-5 py-4">
            <DialogTitle>
              {mappingDraft?.id === null ? 'Mapear plano ao checkout' : 'Editar mapeamento'}
            </DialogTitle>
            <DialogDescription>
              {mappingDraft?.id === null
                ? 'Escolha o produto do provedor ou informe seus IDs. O vínculo controla qual acesso será liberado.'
                : 'Conexão, plano e modalidade são permanentes neste vínculo; preço, valor e disponibilidade podem ser atualizados.'}
            </DialogDescription>
          </DialogHeader>
          {mappingDraft && (
            <div className="grid max-h-[65vh] gap-4 overflow-y-auto p-5">
              <div data-kodety-onboarding="members-commerce-plan-link" className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <Label>Conexão</Label>
                  <Select
                    disabled={mappingDraft.id !== null}
                    value={mappingDraft.connectionId || '__none'}
                    onValueChange={connectionId => setMappingDraft(current => {
                      if (!current) return current;
                      const normalizedId = connectionId === '__none' ? '' : connectionId;
                      const selected = connections.find(item => String(item.id) === normalizedId);
                      const modes = connectionPurchaseModes(selected);
                      return {
                        ...current,
                        connectionId: normalizedId,
                        externalProductId: '',
                        externalPriceId: '',
                        mode: modes.includes(current.mode) ? current.mode : modes[0],
                      };
                    })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Selecione</SelectItem>
                      {(mappingDraft.id !== null ? connections : mappableConnections).map(connection => (
                        <SelectItem key={String(connection.id)} value={String(connection.id)}>
                          {connection.name} · {PROVIDERS[connection.provider].label}
                          {connection.status === 'pending' ? ' · verificação pendente' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="grid gap-1.5">
                  <Label>Plano Kodety</Label>
                  <Select
                    disabled={mappingDraft.id !== null}
                    value={mappingDraft.planId || '__none'}
                    onValueChange={planId => setMappingDraft(current => current ? {
                      ...current,
                      planId: planId === '__none' ? '' : planId,
                    } : current)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Selecione</SelectItem>
                      {activePlans.map(plan => <SelectItem key={String(plan.id)} value={String(plan.id)}>{plan.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
              </div>
              {selectedMappingConnection?.status === 'pending' && (
                <p className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[9px] leading-4 text-amber-100">
                  Este provedor não confirmou a conexão por um teste read-only. Você pode
                  salvar o mapeamento; as credenciais e o checkout serão validados na primeira
                  criação de cobrança.
                </p>
              )}
              {productsLoading ? (
                <p className="flex items-center gap-2 text-[9px] text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Consultando catálogo…</p>
              ) : products.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5">
                    <Label>Produto</Label>
                    <Select value={mappingDraft.externalProductId || '__manual'} onValueChange={selectProduct}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {products.filter(product => product.active).map(product => (
                          <SelectItem key={product.id} value={product.id}>{product.name || product.id}</SelectItem>
                        ))}
                        <SelectItem value="__manual">Informar ID manualmente</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="grid gap-1.5">
                    <Label>Preço</Label>
                    <Select value={mappingDraft.externalPriceId || '__none'} onValueChange={selectPrice}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Sem preço separado</SelectItem>
                        {products
                          .find(product => product.id === mappingDraft.externalProductId)
                          ?.prices.filter(price =>
                            price.active
                            && (mappingDraft.id === null || price.mode === mappingDraft.mode))
                          .map(price => (
                            <SelectItem key={price.id} value={price.id}>
                              {price.name || price.id} · {formatMoney(price.amount, price.currency)}
                              {' · '}
                              {price.mode === 'subscription' ? 'Assinatura' : 'Venda única'}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </label>
                </div>
              ) : null}
              {productsError && (
                <p className="rounded-lg border border-amber-500/15 bg-amber-500/[0.05] px-3 py-2 text-[9px] text-amber-100">
                  {productsError} Você ainda pode informar os IDs manualmente.
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <Label>
                    {selectedMappingConnection?.provider === 'hotmart'
                      ? 'ID ou UCODE do produto Hotmart'
                      : selectedMappingConnection?.provider === 'ticto'
                        ? 'ID do produto Ticto · opcional'
                        : 'ID do produto externo'}
                  </Label>
                  <Input
                    value={mappingDraft.externalProductId}
                    onChange={event => setMappingDraft(current => current ? {
                      ...current,
                      externalProductId: event.target.value,
                    } : current)}
                  />
                </label>
                <label className="grid gap-1.5">
                  <Label>
                    {selectedMappingConnection
                    && PROVIDER_USES_OFFER_CODE.has(selectedMappingConnection.provider)
                      ? 'Código da oferta · obrigatório'
                      : 'ID do preço externo · opcional'}
                  </Label>
                  <Input
                    value={mappingDraft.externalPriceId}
                    onChange={event => setMappingDraft(current => current ? {
                      ...current,
                      externalPriceId: event.target.value,
                    } : current)}
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <Label>
                    {selectedMappingConnection
                    && PROVIDER_CONTROLS_PRICE.has(selectedMappingConnection.provider)
                      ? 'Valor de referência · opcional'
                      : 'Valor · obrigatório'}
                  </Label>
                  <Input
                    inputMode="decimal"
                    placeholder="99,90"
                    value={mappingDraft.amount === null ? '' : mappingDraft.amount / 100}
                    onChange={event => {
                      const numeric = Number(event.target.value.replace(',', '.'));
                      setMappingDraft(current => current ? {
                        ...current,
                        amount: Number.isFinite(numeric) && numeric >= 0
                          ? Math.round(numeric * 100)
                          : null,
                      } : current);
                    }}
                  />
                  <span className="text-[8px] text-muted-foreground">Enviado ao servidor em centavos; nunca representa saldo.</span>
                </label>
                <label className="grid gap-1.5">
                  <Label>Moeda</Label>
                  <Input
                    value={mappingDraft.currency}
                    maxLength={3}
                    placeholder="BRL"
                    onChange={event => setMappingDraft(current => current ? {
                      ...current,
                      currency: event.target.value.replace(/[^a-z]/gi, '').slice(0, 3).toLocaleUpperCase(),
                    } : current)}
                  />
                </label>
              </div>
              <label className="grid gap-1.5">
                <Label>Modalidade da compra</Label>
                <Select
                  disabled={mappingDraft.id !== null}
                  value={mappingDraft.mode}
                  onValueChange={mode => setMappingDraft(current => current ? {
                    ...current,
                    mode: mode as HtmlMembershipPurchaseMode,
                  } : current)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {selectedPurchaseModes.includes('payment') && (
                      <SelectItem value="payment">Venda única</SelectItem>
                    )}
                    {selectedPurchaseModes.includes('subscription') && (
                      <SelectItem value="subscription">Assinatura</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {selectedMappingConnection && (
                  <span className="text-[8px] text-muted-foreground">
                    Modalidades limitadas às capabilities confirmadas pela conexão.
                  </span>
                )}
              </label>
              {mappingDraft.id !== null && (
                <label className="grid gap-1.5">
                  <Label>Disponibilidade do link permanente</Label>
                  <Select
                    value={mappingDraft.status}
                    onValueChange={status => setMappingDraft(current => current ? {
                      ...current,
                      status: status as 'active' | 'paused',
                    } : current)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Ativo · aceita novos checkouts</SelectItem>
                      <SelectItem value="paused">Pausado · preserva histórico</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              )}
            </div>
          )}
          <DialogFooter className="border-t px-5 py-3">
            <Button variant="secondary" disabled={mappingSaving} onClick={() => setMappingDraft(null)}>Cancelar</Button>
            <Button disabled={mappingSaving} onClick={() => void saveMapping()}>
              {mappingSaving ? <Loader2 className="animate-spin" /> : <Link2 />}
              {mappingSaving
                ? 'Salvando…'
                : mappingDraft?.id === null
                  ? 'Criar mapeamento'
                  : 'Salvar mapeamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={checkoutDraft !== null}
        onOpenChange={next => { if (!next && !checkoutCreating) setCheckoutDraft(null); }}
      >
        <DialogContent className="max-w-lg gap-0 overflow-hidden p-0">
          <DialogHeader className="m-0 border-b px-5 py-4">
            <DialogTitle>Criar checkout temporário</DialogTitle>
            <DialogDescription>
              {selectedCheckoutMapping
                && htmlMembershipCommerceRequiresCustomerEmail(selectedCheckoutMapping.provider)
                ? selectedCheckoutMapping.provider === 'iugu'
                  ? 'A Iugu exige o e-mail do cliente para emitir a fatura hospedada. Este URL pode expirar.'
                  : 'O Kodety exige e-mail no checkout Woovi para associar o Pix ao membro. Este URL pode expirar.'
                : 'Para uma prévia ou cliente específico. Não publique este URL em uma LP; ele pode expirar.'}
            </DialogDescription>
          </DialogHeader>
          {checkoutDraft && (
            <div className="grid gap-4 p-5">
              <label className="grid gap-1.5">
                <Label>Após pagamento</Label>
                <Input
                  type="url"
                  value={checkoutDraft.successUrl}
                  onChange={event => setCheckoutDraft(current => current ? { ...current, successUrl: event.target.value } : current)}
                />
              </label>
              <label className="grid gap-1.5">
                <Label>Ao cancelar</Label>
                <Input
                  type="url"
                  value={checkoutDraft.cancelUrl}
                  onChange={event => setCheckoutDraft(current => current ? { ...current, cancelUrl: event.target.value } : current)}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <Label>ID do membro existente · opcional</Label>
                  <Input
                    inputMode="numeric"
                    disabled={!canManageMembers}
                    value={checkoutDraft.memberId}
                    placeholder={canManageMembers ? 'Ex.: 42' : 'Sem permissão para vincular membro'}
                    onChange={event => setCheckoutDraft(current => current ? {
                      ...current,
                      memberId: event.target.value.replace(/\D/g, ''),
                    } : current)}
                  />
                  <span className="text-[8px] leading-3 text-muted-foreground">
                    Para uma conta existente, informe o ID: e-mail sozinho nunca vincula
                    uma compra a outro usuário por coincidência.
                  </span>
                </label>
                <label className="grid gap-1.5">
                  <Label>
                    E-mail do cliente
                    {selectedCheckoutMapping
                      && htmlMembershipCommerceRequiresCustomerEmail(selectedCheckoutMapping.provider)
                      ? ' · obrigatório'
                      : ' · opcional'}
                  </Label>
                  <Input
                    type="email"
                    required={Boolean(
                      selectedCheckoutMapping
                      && htmlMembershipCommerceRequiresCustomerEmail(selectedCheckoutMapping.provider),
                    )}
                    value={checkoutDraft.customerEmail}
                    onChange={event => setCheckoutDraft(current => current ? { ...current, customerEmail: event.target.value } : current)}
                  />
                </label>
                <label className="grid gap-1.5 sm:col-span-2">
                  <Label>Referência · opcional</Label>
                  <Input
                    value={checkoutDraft.clientReference}
                    onChange={event => setCheckoutDraft(current => current ? { ...current, clientReference: event.target.value } : current)}
                  />
                </label>
              </div>
            </div>
          )}
          <DialogFooter className="border-t px-5 py-3">
            <Button variant="secondary" disabled={checkoutCreating} onClick={() => setCheckoutDraft(null)}>Cancelar</Button>
            <Button disabled={checkoutCreating} onClick={() => void createCheckoutPreview()}>
              {checkoutCreating ? <Loader2 className="animate-spin" /> : <ShoppingCart />}
              {checkoutCreating ? 'Criando…' : 'Criar checkout'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={generatedLink !== null} onOpenChange={next => { if (!next) setGeneratedLink(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{generatedLink?.title}</DialogTitle>
            <DialogDescription>{generatedLink?.description}</DialogDescription>
          </DialogHeader>
          {generatedLink && (
            <div className="grid gap-3">
              <Input readOnly value={generatedLink.url} />
              {generatedLink.expiresAt && (
                <p className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
                  <KeyRound className="size-3" /> Expira em {formatDate(generatedLink.expiresAt)}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={() => void copyLink(generatedLink.url, 'Link')}>
                  <Clipboard /> Copiar
                </Button>
                {generatedLink.allowOpen !== false && (
                  <Button asChild>
                    <a href={generatedLink.url} target="_blank" rel="noreferrer">
                      <ExternalLink /> Abrir
                    </a>
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={disconnecting !== null}
        onOpenChange={next => { if (!next) setDisconnecting(null); }}
        title="Remover conexão nunca usada?"
        description="A remoção só é aceita quando nunca houve venda e não existem mapeamentos ou contratos. Depois do primeiro uso, a conexão deve apenas ser desativada para continuar recebendo estornos, chargebacks e eventos tardios sem permitir novas vendas."
        confirmLabel="Remover conexão nunca usada"
        onConfirm={removeConnection}
      />
      <ConfirmDialog
        open={deleteMapping !== null}
        onOpenChange={next => { if (!next) setDeleteMapping(null); }}
        title="Remover mapeamento?"
        description="O link de venda deixa de criar checkouts. O plano, os membros e o histórico comercial permanecem preservados."
        confirmLabel="Remover mapeamento"
        onConfirm={removeMapping}
      />
    </div>
  );
}
