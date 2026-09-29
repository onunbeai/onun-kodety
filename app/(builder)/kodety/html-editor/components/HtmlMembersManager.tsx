'use client';

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Clipboard,
  ExternalLink,
  KeyRound,
  Layers3,
  Loader2,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShoppingCart,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRoundCheck,
  UserRoundX,
  UsersRound,
} from '@/components/ui/gravity-icons';
import { toast } from 'sonner';
import { getAdminUiLocale } from '@/lib/admin-ui-locale';
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
import { Textarea } from '@/components/ui/textarea';
import {
  createHtmlMembershipClient,
  membershipApiConfigFromWordPressConfig,
  type CreateHtmlMembershipMemberInput,
  type HtmlMembershipApiConfig,
  type HtmlMembershipCommerceMapping,
  type HtmlMembershipDataSource,
  type HtmlMembershipMember,
  type HtmlMembershipMemberStatus,
  type HtmlMembershipOverview,
  type HtmlMembershipPlan,
  type HtmlMembershipPlanStatus,
  type HtmlMembershipRuntimeSettings,
  type HtmlMembershipWordPressConfig,
  type SaveHtmlMembershipPlanInput,
} from '@/lib/html-editor/membership-client';
import { normalizeMembershipPlanKey } from '@/lib/html-editor/membership';
import { cn } from '@/lib/utils';

const HtmlMembersCommerce = lazy(() =>
  import('./HtmlMembersCommerce').then(module => ({ default: module.HtmlMembersCommerce })),
);

export type HtmlMembersManagerTab = 'members' | 'plans' | 'commerce' | 'settings';

/**
 * The manager can consume WordPress URLs directly (`api`) or a test/custom
 * adapter (`dataSource`). `projectEnabled` represents the Builder metadata
 * flag; the WordPress runtime has an independent activation state.
 */
export interface HtmlMembersManagerProps {
  logoMenu?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  standalone?: boolean;
  readOnly?: boolean;
  backHref?: string;
  initialTab?: HtmlMembersManagerTab;
  api?: HtmlMembershipApiConfig;
  dataSource?: HtmlMembershipDataSource;
  projectId?: string;
  projectEnabled?: boolean;
  onProjectEnabledChange?: (enabled: boolean) => void | Promise<void>;
}

interface MemberDraft {
  email: string;
  displayName: string;
  password: string;
  status: HtmlMembershipMemberStatus;
  planKeys: string[];
  sendInvite: boolean;
}

interface PlanDraft extends SaveHtmlMembershipPlanInput {
  status: HtmlMembershipPlanStatus;
}

const EMPTY_MEMBER: MemberDraft = {
  email: '',
  displayName: '',
  password: '',
  status: 'active',
  planKeys: [],
  sendInvite: true,
};

const EMPTY_PLAN: PlanDraft = {
  key: '',
  name: '',
  description: '',
  status: 'active',
  upgradeUrl: '',
  provider: '',
  externalId: '',
};

const EMPTY_SETTINGS: HtmlMembershipRuntimeSettings = {
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

const MEMBER_STATUS_LABELS: Record<HtmlMembershipMemberStatus, string> = {
  active: 'Ativo',
  invited: 'Convidado',
  suspended: 'Suspenso',
};

const PLAN_STATUS_LABELS: Record<HtmlMembershipPlanStatus, string> = {
  active: 'Ativo',
  draft: 'Rascunho',
  archived: 'Arquivado',
};

function managerWordPressConfig() {
  if (typeof window === 'undefined') return null;
  return (window as typeof window & {
    kodetyWordPress?: HtmlMembershipWordPressConfig;
  }).kodetyWordPress || null;
}

function errorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return '';
  return error instanceof Error ? error.message : 'Não foi possível concluir esta operação.';
}

function formatDate(value: string) {
  if (!value) return 'Nunca';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString(getAdminUiLocale(), { dateStyle: 'short', timeStyle: 'short' });
}

function memberStatusTone(status: HtmlMembershipMemberStatus) {
  if (status === 'active') return 'border-emerald-500/15 bg-emerald-500/10 text-emerald-300';
  if (status === 'invited') return 'border-[var(--kodety-accent)]/15 bg-[var(--kodety-accent)]/10 text-[var(--kodety-accent-hover)]';
  return 'border-amber-500/15 bg-amber-500/10 text-amber-300';
}

function planStatusTone(status: HtmlMembershipPlanStatus) {
  if (status === 'active') return 'border-emerald-500/15 bg-emerald-500/10 text-emerald-300';
  if (status === 'draft') return 'border-amber-500/15 bg-amber-500/10 text-amber-300';
  return 'border-white/[0.08] bg-white/[0.035] text-muted-foreground';
}

function initials(member: HtmlMembershipMember) {
  const label = member.displayName || member.email;
  return label
    .split(/\s+/)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toLocaleUpperCase();
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof UsersRound;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.018] p-3">
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <strong className="mt-2 block text-xl font-semibold tracking-tight">{value.toLocaleString(getAdminUiLocale())}</strong>
    </div>
  );
}

function EmptyState({
  action,
  description,
  icon: Icon,
  title,
}: {
  action?: React.ReactNode;
  description: string;
  icon: typeof UsersRound;
  title: string;
}) {
  return (
    <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-white/[0.1] bg-white/[0.012] p-8 text-center">
      <div className="max-w-sm">
        <span className="mx-auto grid size-10 place-items-center rounded-xl bg-white/[0.045] text-muted-foreground">
          <Icon className="size-4.5" />
        </span>
        <h3 className="mt-3 text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-[10px] leading-5 text-muted-foreground">{description}</p>
        {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      </div>
    </div>
  );
}

function PlanChecks({
  disabled,
  onChange,
  plans,
  value,
}: {
  disabled?: boolean;
  onChange: (keys: string[]) => void;
  plans: readonly HtmlMembershipPlan[];
  value: readonly string[];
}) {
  const selectable = plans.filter(plan => plan.status === 'active');
  if (!selectable.length) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-4 text-center text-[10px] text-muted-foreground">
        Nenhum plano disponível. Salve o membro sem plano ou crie um plano primeiro.
      </p>
    );
  }
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {selectable.map(plan => {
        const selected = value.includes(plan.key);
        return (
          <button
            key={plan.key}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange(
              selected ? value.filter(key => key !== plan.key) : [...value, plan.key],
            )}
            className={cn(
              'flex min-h-11 items-center gap-2 rounded-lg border px-2.5 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50',
              selected
                ? 'border-[var(--kodety-accent-hover)]/35 bg-[var(--kodety-accent)]/10'
                : 'border-white/[0.08] bg-white/[0.018] hover:bg-white/[0.045]',
            )}
          >
            <span className={cn(
              'grid size-4 place-items-center rounded border text-[9px]',
              selected ? 'border-[var(--kodety-accent-hover)]/35 bg-[var(--kodety-accent)]/14 text-[var(--kodety-accent-hover)]' : 'border-white/15',
            )}>
              {selected ? '✓' : ''}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[10px] font-medium">{plan.name}</span>
              <span className="block truncate font-mono text-[8px] text-muted-foreground">{plan.key}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ActivationPanel({
  activating,
  apiEnabled,
  canManageSettings,
  canActivateProject,
  error,
  onActivate,
  projectEnabled,
  projectManaged,
}: {
  activating: boolean;
  apiEnabled: boolean;
  canManageSettings: boolean;
  canActivateProject: boolean;
  error: string;
  onActivate: () => void;
  projectEnabled: boolean;
  projectManaged: boolean;
}) {
  const blocked = !canManageSettings
    || (projectManaged && !projectEnabled && !canActivateProject);
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-5 rounded-2xl border border-white/[0.08] bg-white/[0.018] p-6 shadow-2xl shadow-black/10">
      <span className="grid size-11 place-items-center rounded-2xl bg-[var(--kodety-accent)]/10 text-[var(--kodety-accent-hover)]">
        <ShieldCheck className="size-5" />
      </span>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Ative a Área de Membros</h2>
        <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
          A ativação prepara o runtime do WordPress e registra o contrato no projeto.
          Nenhum conteúdo fica protegido até os dois estados estarem ativos.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex items-start gap-2.5 rounded-xl border border-white/[0.07] p-3">
          {apiEnabled
            ? <BadgeCheck className="mt-0.5 size-4 text-emerald-300" />
            : <ShieldAlert className="mt-0.5 size-4 text-amber-300" />}
          <span>
            <span className="block text-[11px] font-medium">Projeto no WordPress</span>
            <span className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">
              {apiEnabled
                ? 'Autorizado no runtime e pronto para avaliar acessos.'
                : 'Ainda não foi incluído na lista de projetos ativos.'}
            </span>
          </span>
        </div>
        <div className="flex items-start gap-2.5 rounded-xl border border-white/[0.07] p-3">
          {projectEnabled
            ? <BadgeCheck className="mt-0.5 size-4 text-emerald-300" />
            : <ShieldAlert className="mt-0.5 size-4 text-amber-300" />}
          <span>
            <span className="block text-[11px] font-medium">Projeto do Builder</span>
            <span className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">
              {!projectManaged
                ? 'O host não gerencia metadados; o runtime será a fonte de ativação.'
                : projectEnabled
                  ? 'O schema versionado está habilitado.'
                  : 'O projeto ainda está em modo público.'}
            </span>
          </span>
        </div>
      </div>
      {blocked && (
        <p role="alert" className="rounded-lg border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2 text-[10px] leading-4 text-amber-100">
          {!canManageSettings
            ? 'Sua conta pode consultar membros, mas não possui permissão para ativar projetos.'
            : (
              <>
                Este host informou que o projeto está desativado, mas não forneceu
                <code className="mx-1 rounded bg-black/20 px-1">onProjectEnabledChange</code>.
                Conecte o callback antes de ativar.
              </>
            )}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-[10px] text-red-200">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] pt-4">
        <p className="text-[9px] leading-4 text-muted-foreground">
          Abrir esta tela nunca ativa recursos automaticamente.
        </p>
        <Button disabled={activating || blocked} onClick={onActivate}>
          {activating ? <Loader2 className="animate-spin" /> : <KeyRound />}
          {activating ? 'Ativando…' : 'Ativar área'}
        </Button>
      </div>
    </div>
  );
}

export function HtmlMembersManager({
  logoMenu,
  open = true,
  onOpenChange,
  standalone = false,
  readOnly = false,
  backHref,
  initialTab = 'members',
  api,
  dataSource,
  projectId,
  projectEnabled,
  onProjectEnabledChange,
}: HtmlMembersManagerProps) {
  const onboardingActive = useBuilderOnboardingActive();
  const [tab, setTab] = useState<HtmlMembersManagerTab>(initialTab);
  const [overview, setOverview] = useState<HtmlMembershipOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const [activating, setActivating] = useState(false);
  const [activationError, setActivationError] = useState('');
  const [projectEnabledOverride, setProjectEnabledOverride] = useState(false);

  const [plans, setPlans] = useState<HtmlMembershipPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState('');
  const [plansRefresh, setPlansRefresh] = useState(0);
  const [editingPlan, setEditingPlan] = useState<HtmlMembershipPlan | 'new' | null>(null);
  const [planDraft, setPlanDraft] = useState<PlanDraft>(EMPTY_PLAN);
  const [planSaving, setPlanSaving] = useState(false);
  const [archivePlan, setArchivePlan] = useState<HtmlMembershipPlan | null>(null);

  const [members, setMembers] = useState<HtmlMembershipMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState('');
  const [membersRefresh, setMembersRefresh] = useState(0);
  const [memberPage, setMemberPage] = useState(1);
  const [memberTotal, setMemberTotal] = useState(0);
  const [memberTotalPages, setMemberTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [editingMember, setEditingMember] = useState<HtmlMembershipMember | 'new' | null>(null);
  const [memberDraft, setMemberDraft] = useState<MemberDraft>(EMPTY_MEMBER);
  const [memberSaving, setMemberSaving] = useState(false);
  const [deleteMember, setDeleteMember] = useState<HtmlMembershipMember | null>(null);
  const [memberActions, setMemberActions] = useState<HtmlMembershipMember | null>(null);
  const [memberActionLoading, setMemberActionLoading] = useState<'access' | 'reset' | 'email' | ''>('');
  const [memberActionLink, setMemberActionLink] = useState<{
    label: string;
    url: string;
    expiresAt: string;
  } | null>(null);
  const [memberActionPlanId, setMemberActionPlanId] = useState('');
  const [memberActionReason, setMemberActionReason] = useState('');
  const [memberAccessChanging, setMemberAccessChanging] = useState<'grant' | 'revoke' | 'restore' | ''>('');

  const [settings, setSettings] = useState<HtmlMembershipRuntimeSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<HtmlMembershipRuntimeSettings>(EMPTY_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);

  const resolvedApi = useMemo(() => {
    const source = api || membershipApiConfigFromWordPressConfig(managerWordPressConfig());
    if (!source) return null;
    return projectId && source.projectId !== projectId
      ? { ...source, projectId }
      : source;
  }, [api, projectId]);
  const client = useMemo(
    () => dataSource || (resolvedApi ? createHtmlMembershipClient(resolvedApi) : null),
    [dataSource, resolvedApi],
  );
  const projectManaged = projectEnabled !== undefined;
  const effectiveProjectEnabled = projectManaged
    ? Boolean(projectEnabled || projectEnabledOverride)
    : true;
  const fullyEnabled = Boolean(overview?.enabled && effectiveProjectEnabled);

  useEffect(() => {
    setProjectEnabledOverride(false);
  }, [projectEnabled]);

  const reloadOverview = useCallback(async (signal?: AbortSignal) => {
    if (!client) return null;
    setOverviewLoading(true);
    setOverviewError('');
    try {
      const next = await client.loadOverview(signal);
      setOverview(next);
      return next;
    } catch (error) {
      const message = errorMessage(error);
      if (message) setOverviewError(message);
      return null;
    } finally {
      if (!signal?.aborted) setOverviewLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (!open || !client) return;
    const controller = new AbortController();
    void reloadOverview(controller.signal);
    return () => controller.abort();
  }, [client, open, reloadOverview]);

  useEffect(() => {
    if (!open || !client || !fullyEnabled) return;
    const controller = new AbortController();
    setPlansLoading(true);
    setPlansError('');
    void client.loadPlans(controller.signal)
      .then(setPlans)
      .catch(error => {
        const message = errorMessage(error);
        if (message) setPlansError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setPlansLoading(false);
      });
    return () => controller.abort();
  }, [client, fullyEnabled, open, plansRefresh]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setMemberPage(1);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    setMemberPage(1);
  }, [planFilter, statusFilter]);

  useEffect(() => {
    if (!open || !client || !fullyEnabled || tab !== 'members') return;
    const controller = new AbortController();
    setMembersLoading(true);
    setMembersError('');
    void client.loadMembers({
      page: memberPage,
      perPage: 20,
      search: debouncedSearch,
      status: statusFilter as '' | HtmlMembershipMemberStatus,
      planKey: planFilter,
      signal: controller.signal,
    }).then(result => {
      setMembers(result.items);
      setMemberTotal(result.total);
      setMemberTotalPages(result.totalPages);
      if (result.page !== memberPage) setMemberPage(result.page);
    }).catch(error => {
      const message = errorMessage(error);
      if (message) setMembersError(message);
    }).finally(() => {
      if (!controller.signal.aborted) setMembersLoading(false);
    });
    return () => controller.abort();
  }, [
    client,
    debouncedSearch,
    fullyEnabled,
    memberPage,
    membersRefresh,
    open,
    planFilter,
    statusFilter,
    tab,
  ]);

  useEffect(() => {
    if (!open || !client || !fullyEnabled || tab !== 'settings') return;
    const controller = new AbortController();
    setSettingsLoading(true);
    setSettingsError('');
    void client.loadSettings(controller.signal)
      .then(next => {
        setSettings(next);
        setSettingsDraft(next);
      })
      .catch(error => {
        const message = errorMessage(error);
        if (message) setSettingsError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSettingsLoading(false);
      });
    return () => controller.abort();
  }, [client, fullyEnabled, open, tab]);

  const activate = async () => {
    if (!client) return;
    setActivating(true);
    setActivationError('');
    let enabledByThisAttempt = false;
    try {
      let nextOverview = overview;
      if (!overview?.enabled) {
        nextOverview = await client.setEnabled(true);
        enabledByThisAttempt = true;
        setOverview(nextOverview);
      }
      if (projectManaged && !effectiveProjectEnabled) {
        if (!onProjectEnabledChange) {
          throw new Error('O host não conectou a ativação do projeto.');
        }
        await onProjectEnabledChange(true);
        setProjectEnabledOverride(true);
      }
      if (!nextOverview?.enabled) {
        nextOverview = await reloadOverview();
      }
      if (!nextOverview?.enabled) {
        throw new Error('O WordPress não confirmou a ativação da Área de Membros.');
      }
      toast.success('Área de Membros ativada.');
    } catch (error) {
      const message = errorMessage(error);
      if (enabledByThisAttempt) {
        try {
          const rolledBack = await client.setEnabled(false);
          setOverview(rolledBack);
        } catch {
          setActivationError(`${message} O WordPress não confirmou o rollback; tente novamente.`);
          return;
        }
      }
      setActivationError(message);
    } finally {
      setActivating(false);
    }
  };

  const openMemberEditor = (member: HtmlMembershipMember | 'new') => {
    setEditingMember(member);
    setMemberDraft(member === 'new'
      ? { ...EMPTY_MEMBER, planKeys: [] }
      : {
          email: member.email,
          displayName: member.displayName,
          password: '',
          status: member.status,
          planKeys: [...member.planKeys],
          sendInvite: false,
        });
  };

  const saveMember = async () => {
    if (!client || !editingMember) return;
    const email = memberDraft.email.trim();
    if (editingMember === 'new' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Informe um e-mail válido.');
      return;
    }
    if (
      editingMember === 'new'
      && !memberDraft.sendInvite
      && memberDraft.password.length < 12
    ) {
      toast.error('A senha inicial precisa ter pelo menos 12 caracteres.');
      return;
    }
    setMemberSaving(true);
    try {
      if (editingMember === 'new') {
        const input: CreateHtmlMembershipMemberInput = {
          email,
          displayName: memberDraft.displayName.trim(),
          ...(!memberDraft.sendInvite ? { password: memberDraft.password } : {}),
          ...(canAssignPlans ? { planKeys: memberDraft.planKeys } : {}),
          sendInvite: memberDraft.sendInvite,
        };
        await client.createMember(input);
        toast.success(memberDraft.sendInvite ? 'Convite enviado.' : 'Membro criado.');
      } else {
        await client.updateMember(editingMember.id, {
          displayName: memberDraft.displayName.trim(),
          status: memberDraft.status,
          ...(canAssignPlans ? { planKeys: memberDraft.planKeys } : {}),
        });
        toast.success('Membro atualizado.');
      }
      setEditingMember(null);
      setMembersRefresh(value => value + 1);
      void reloadOverview();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setMemberSaving(false);
    }
  };

  const removeMember = async () => {
    if (!client || !deleteMember) return;
    await client.updateMember(deleteMember.id, {
      status: 'suspended',
      ...(canAssignPlans ? { planKeys: [] } : {}),
    });
    toast.success(canAssignPlans
      ? 'Acesso suspenso e planos removidos.'
      : 'Acesso suspenso.');
    setDeleteMember(null);
    setMembersRefresh(value => value + 1);
    void reloadOverview();
  };

  const createMemberActionLink = async (kind: 'access' | 'reset') => {
    if (!client || !memberActions) return;
    const action = kind === 'access'
      ? client.createMemberAccessLink
      : client.createMemberResetLink;
    if (!action) {
      toast.error('Este host não disponibilizou links temporários seguros.');
      return;
    }
    setMemberActionLoading(kind);
    try {
      const link = await action(memberActions.id);
      setMemberActionLink({
        label: kind === 'access' ? 'Link de acesso' : 'Link de redefinição',
        ...link,
      });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setMemberActionLoading('');
    }
  };

  const sendMemberReset = async () => {
    if (!client?.sendMemberResetEmail || !memberActions) {
      toast.error('Este host não disponibilizou o envio seguro de redefinição.');
      return;
    }
    setMemberActionLoading('email');
    try {
      await client.sendMemberResetEmail(memberActions.id);
      toast.success(`E-mail de redefinição enviado para ${memberActions.email}.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setMemberActionLoading('');
    }
  };

  const copyMemberActionLink = async () => {
    if (!memberActionLink) return;
    try {
      await navigator.clipboard.writeText(memberActionLink.url);
      toast.success(`${memberActionLink.label} copiado.`);
    } catch {
      toast.error('O navegador não permitiu copiar o link.');
    }
  };

  const changeMemberAccess = async (action: 'grant' | 'revoke' | 'restore') => {
    if (!client?.changeMemberAccess || !memberActions || !memberActionPlanId) {
      toast.error('Selecione um plano para alterar o acesso.');
      return;
    }
    setMemberAccessChanging(action);
    try {
      const result = await client.changeMemberAccess(memberActions.id, {
        planId: memberActionPlanId,
        action,
        reason: memberActionReason.trim() || undefined,
      });
      const labels = {
        granted: 'Acesso adicionado.',
        revoked: 'Acesso removido. A cobrança não foi cancelada nem reembolsada.',
        restored: 'Bloqueio removido. O acesso será recalculado pelas assinaturas e concessões.',
      } as const;
      toast.success(labels[result.access]);
      setMembersRefresh(value => value + 1);
      void reloadOverview();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setMemberAccessChanging('');
    }
  };

  const openPlanEditor = (plan: HtmlMembershipPlan | 'new') => {
    setEditingPlan(plan);
    setPlanDraft(plan === 'new'
      ? { ...EMPTY_PLAN }
      : {
          key: plan.key,
          name: plan.name,
          description: plan.description,
          status: plan.status,
          upgradeUrl: plan.upgradeUrl,
          provider: plan.provider,
          externalId: plan.externalId,
        });
  };

  const savePlan = async () => {
    if (!client || !editingPlan) return;
    const next: PlanDraft = {
      ...planDraft,
      key: normalizeMembershipPlanKey(planDraft.key),
      name: planDraft.name.trim(),
      description: planDraft.description?.trim(),
      upgradeUrl: planDraft.upgradeUrl?.trim(),
      provider: planDraft.provider?.trim(),
      externalId: planDraft.externalId?.trim(),
    };
    if (!next.key || !next.name) {
      toast.error('Informe nome e identificador do plano.');
      return;
    }
    setPlanSaving(true);
    try {
      if (editingPlan === 'new') {
        await client.createPlan(next);
        toast.success('Plano criado.');
      } else {
        await client.updatePlan(editingPlan.id, next);
        toast.success('Plano atualizado.');
      }
      setEditingPlan(null);
      setPlansRefresh(value => value + 1);
      void reloadOverview();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPlanSaving(false);
    }
  };

  const archiveSelectedPlan = async () => {
    if (!client || !archivePlan) return;
    await client.updatePlan(archivePlan.id, {
      key: archivePlan.key,
      name: archivePlan.name,
      description: archivePlan.description,
      status: 'archived',
      upgradeUrl: archivePlan.upgradeUrl,
      provider: archivePlan.provider,
      externalId: archivePlan.externalId,
    });
    toast.success('Plano arquivado. Regras existentes continuam identificáveis.');
    setArchivePlan(null);
    setPlansRefresh(value => value + 1);
    void reloadOverview();
  };

  const manageMemberById = async (id: string | number) => {
    if (!client?.loadMember) {
      setTab('members');
      toast.error('Este host não disponibilizou a consulta individual do membro.');
      return;
    }
    try {
      const member = await client.loadMember(id);
      setTab('members');
      openMemberEditor(member);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const useMappingAsUpgrade = async (mapping: HtmlMembershipCommerceMapping) => {
    if (!client || !mapping.publicUrl) return;
    const plan = plans.find(item => String(item.id) === String(mapping.planId));
    if (!plan) {
      toast.error('O plano deste mapeamento não foi encontrado no catálogo atual.');
      return;
    }
    try {
      await client.updatePlan(plan.id, {
        key: plan.key,
        name: plan.name,
        description: plan.description,
        status: plan.status,
        upgradeUrl: mapping.publicUrl,
        provider: mapping.provider,
        externalId: mapping.externalPriceId || mapping.externalProductId,
      });
      setPlansRefresh(value => value + 1);
      toast.success(`O upgrade de ${plan.name} agora usa o link de venda permanente.`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const saveSettings = async () => {
    if (!client) return;
    setSettingsSaving(true);
    try {
      const next = await client.saveSettings(settingsDraft);
      setSettings(next);
      setSettingsDraft(next);
      toast.success('Configurações salvas.');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSettingsSaving(false);
    }
  };

  const settingsDirty = Boolean(
    settings && JSON.stringify(settings) !== JSON.stringify(settingsDraft),
  );
  const canManageMembers = !readOnly && (overview?.capabilities.manageMembers ?? false);
  const canCreateMembers = !readOnly && (overview?.capabilities.createMembers ?? false);
  const canAssignPlans = !readOnly && (overview?.capabilities.assignPlans ?? false);
  const canManageCommerce = !readOnly && (overview?.capabilities.manageCommerce ?? false);
  const canManagePlans = !readOnly && (overview?.capabilities.managePlans ?? false);
  const canManageSettings = !readOnly && (overview?.capabilities.manageSettings ?? false);
  const visiblePlans = plans.filter(plan => plan.status === 'active');

  const tabs: Array<{
    value: HtmlMembersManagerTab;
    label: string;
    icon: typeof UsersRound;
  }> = [
    { value: 'members', label: 'Membros', icon: UsersRound },
    { value: 'plans', label: 'Planos', icon: Layers3 },
    ...(client?.commerceAvailable
      ? [{ value: 'commerce' as const, label: 'Checkouts', icon: ShoppingCart }]
      : []),
    { value: 'settings', label: 'Configurações', icon: Settings2 },
  ];

  const membersContent = (
    <section data-kodety-onboarding="members-list" className="grid gap-4">
      <div className="grid gap-2 md:grid-cols-3">
        <Metric icon={UsersRound} label="Membros totais" value={overview?.memberCount || 0} />
        <Metric icon={UserRoundCheck} label="Membros ativos" value={overview?.activeMemberCount || 0} />
        <Metric icon={Layers3} label="Planos" value={overview?.planCount || 0} />
      </div>
      <div data-kodety-onboarding="members-list-filters" className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Buscar por nome ou e-mail…"
            className="pl-8"
          />
        </div>
        <Select value={statusFilter || '__all'} onValueChange={value => setStatusFilter(value === '__all' ? '' : value)}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todos os status</SelectItem>
            <SelectItem value="active">Ativos</SelectItem>
            <SelectItem value="invited">Convidados</SelectItem>
            <SelectItem value="suspended">Suspensos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={planFilter || '__all'} onValueChange={value => setPlanFilter(value === '__all' ? '' : value)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todos os planos</SelectItem>
            {visiblePlans.map(plan => <SelectItem key={plan.key} value={plan.key}>{plan.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Atualizar membros"
          disabled={membersLoading}
          onClick={() => setMembersRefresh(value => value + 1)}
        >
          <RefreshCw className={membersLoading ? 'animate-spin' : ''} />
        </Button>
        <Button disabled={!canCreateMembers} onClick={() => openMemberEditor('new')}>
          <Plus /> Adicionar membro
        </Button>
      </div>
      {membersError ? (
        <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/[0.06] p-3 text-xs text-red-200">{membersError}</p>
      ) : membersLoading && !members.length ? (
        <div className="grid min-h-64 place-items-center text-xs text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
      ) : !members.length ? (
        <EmptyState
          icon={UsersRound}
          title="Nenhum membro encontrado"
          description={debouncedSearch || statusFilter || planFilter
            ? 'Ajuste os filtros ou limpe a busca para ver outros membros.'
            : 'Adicione uma pessoa ou envie um convite para começar.'}
          action={canCreateMembers && !debouncedSearch && !statusFilter && !planFilter
            ? <Button onClick={() => openMemberEditor('new')}><Plus /> Adicionar membro</Button>
            : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[0.08]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead className="bg-white/[0.025] text-[9px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Membro</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Planos</th>
                  <th className="px-3 py-2.5 font-medium">Último acesso</th>
                  <th className="w-24 px-3 py-2.5 font-medium"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.065]">
                {members.map(member => (
                  <tr key={String(member.id)} className="bg-white/[0.008] hover:bg-white/[0.025]">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        {member.avatarUrl
                          ? <img src={member.avatarUrl} alt="" className="size-8 rounded-full object-cover" />
                          : <span className="grid size-8 place-items-center rounded-full bg-white/[0.055] text-[9px] font-semibold">{initials(member)}</span>}
                        <span className="min-w-0">
                          <span className="block truncate text-[11px] font-medium">{member.displayName || 'Sem nome'}</span>
                          <span className="block truncate text-[9px] text-muted-foreground">
                            {member.email} · #{member.id}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className={cn('text-[8px]', memberStatusTone(member.status))}>
                        {MEMBER_STATUS_LABELS[member.status]}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex max-w-64 flex-wrap gap-1">
                        {member.planKeys.length
                          ? member.planKeys.map(key => (
                              <Badge key={key} variant="outline" className="border-[var(--kodety-accent)]/15 bg-[var(--kodety-accent)]/[0.06] px-1.5 py-0 font-mono text-[8px] text-[var(--kodety-accent-hover)]">
                                {plans.find(plan => plan.key === key)?.name || key}
                              </Badge>
                            ))
                          : <span className="text-[9px] text-muted-foreground">Sem plano</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[9px] text-muted-foreground">{formatDate(member.lastLoginAt)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          disabled={!canManageCommerce}
                          aria-label={`Links seguros de ${member.displayName || member.email}`}
                          onClick={() => {
                            setMemberActions(member);
                            setMemberActionLink(null);
                            setMemberActionPlanId(String(
                              plans.find(plan => member.planKeys.includes(plan.key))?.id
                                ?? plans.find(plan => plan.status === 'active')?.id
                                ?? '',
                            ));
                            setMemberActionReason('');
                          }}
                        ><KeyRound /></Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          disabled={!canManageMembers}
                          aria-label={`Editar ${member.displayName || member.email}`}
                          onClick={() => openMemberEditor(member)}
                        ><Pencil /></Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          disabled={!canManageMembers}
                          aria-label={`Suspender acesso de ${member.displayName || member.email}`}
                          onClick={() => setDeleteMember(member)}
                        ><UserRoundX /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-white/[0.07] px-3 py-2">
            <span className="text-[9px] text-muted-foreground">
              {memberTotal.toLocaleString(getAdminUiLocale())} {memberTotal === 1 ? 'membro' : 'membros'}
            </span>
            <div className="flex items-center gap-1">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Página anterior"
                disabled={memberPage <= 1 || membersLoading}
                onClick={() => setMemberPage(value => Math.max(1, value - 1))}
              ><ChevronLeft /></Button>
              <span className="min-w-16 text-center text-[9px] text-muted-foreground">{memberPage} / {memberTotalPages}</span>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Próxima página"
                disabled={memberPage >= memberTotalPages || membersLoading}
                onClick={() => setMemberPage(value => Math.min(memberTotalPages, value + 1))}
              ><ChevronRight /></Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );

  const plansContent = (
    <section data-kodety-onboarding="members-plans-list" className="grid gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Planos de acesso</h2>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            A chave é estável e usada pelas regras do Builder e por integrações futuras.
          </p>
        </div>
        <Button disabled={!canManagePlans} onClick={() => openPlanEditor('new')}><Plus /> Novo plano</Button>
      </div>
      {plansError ? (
        <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/[0.06] p-3 text-xs text-red-200">{plansError}</p>
      ) : plansLoading && !plans.length ? (
        <div className="grid min-h-64 place-items-center text-xs text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
      ) : !plans.length ? (
        <EmptyState
          icon={Layers3}
          title="Crie seu primeiro plano"
          description="Planos ligam pessoas a regras de acesso. O checkout pode ser integrado depois sem trocar as chaves."
          action={canManagePlans ? <Button onClick={() => openPlanEditor('new')}><Plus /> Novo plano</Button> : undefined}
        />
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {plans.map(plan => (
            <article key={String(plan.id)} data-kodety-onboarding="members-plan-card" className="rounded-xl border border-white/[0.08] bg-white/[0.012] p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--kodety-accent)]/10 text-[var(--kodety-accent-hover)]">
                  <Layers3 className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-xs font-semibold">{plan.name}</h3>
                    <Badge variant="outline" className={cn('text-[8px]', planStatusTone(plan.status))}>{PLAN_STATUS_LABELS[plan.status]}</Badge>
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[9px] text-muted-foreground">{plan.key}</span>
                </span>
                <div className="flex gap-1">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={!canManagePlans}
                    aria-label={`Editar ${plan.name}`}
                    onClick={() => openPlanEditor(plan)}
                  ><Pencil /></Button>
                  {plan.status !== 'archived' && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      disabled={!canManagePlans}
                      aria-label={`Arquivar ${plan.name}`}
                      onClick={() => setArchivePlan(plan)}
                    ><Trash2 /></Button>
                  )}
                </div>
              </div>
              <p className="mt-3 min-h-8 text-[10px] leading-4 text-muted-foreground">{plan.description || 'Sem descrição.'}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.065] pt-3">
                <span className="text-[9px] text-muted-foreground">{plan.memberCount.toLocaleString(getAdminUiLocale())} membros</span>
                <span className="flex items-center gap-2">
                  {plan.provider && <Badge variant="outline" className="text-[8px]">{plan.provider}</Badge>}
                  {plan.upgradeUrl && (
                    <a href={plan.upgradeUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[9px] text-[var(--kodety-accent-hover)] hover:underline">
                      Upgrade <ExternalLink className="size-2.5" />
                    </a>
                  )}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );

  const commerceContent = client?.commerceAvailable ? (
    <Suspense
      fallback={(
        <div className="grid min-h-64 place-items-center text-xs text-muted-foreground" role="status">
          <Loader2 className="size-5 animate-spin" />
          <span className="sr-only">Carregando commerce</span>
        </div>
      )}
    >
      <HtmlMembersCommerce
        dataSource={client}
        plans={plans}
        canManage={canManageCommerce}
        canManageMembers={canManageMembers}
        onManageMember={manageMemberById}
        onUseMappingAsUpgrade={useMappingAsUpgrade}
      />
    </Suspense>
  ) : null;

  const settingsContent = (
    <section data-kodety-onboarding="members-settings-body" data-kodety-onboarding-navigation-draft="members-settings" data-kodety-onboarding-draft={settingsDirty ? 'members-settings' : undefined} className="mx-auto grid w-full max-w-3xl gap-4">
      <div>
        <h2 className="text-sm font-semibold">Configurações do runtime</h2>
        <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
          O WordPress continua responsável por contas, sessão, retenção e autorização.
        </p>
      </div>
      {settingsError ? (
        <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/[0.06] p-3 text-xs text-red-200">{settingsError}</p>
      ) : settingsLoading && !settings ? (
        <div className="grid min-h-64 place-items-center text-xs text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
      ) : (
        <>
          <div data-kodety-onboarding="members-registration" className="divide-y divide-white/[0.065] rounded-xl border border-white/[0.08] px-4">
            <div className="flex items-center justify-between gap-4 py-4">
              <span>
                <Label>Cadastro público</Label>
                <span className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">Permite que visitantes criem uma conta pelos formulários de membership.</span>
              </span>
              <Switch
                checked={settingsDraft.registrationEnabled}
                disabled={!canManageSettings}
                onCheckedChange={registrationEnabled => setSettingsDraft(current => ({ ...current, registrationEnabled }))}
              />
            </div>
            <div className="flex items-center justify-between gap-4 py-4">
              <span>
                <Label>Verificar e-mail · em preparação</Label>
                <span className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">Permanece indisponível até o runtime ter tokens duráveis e entrega transacional de e-mail.</span>
              </span>
              <Switch
                checked={settingsDraft.requireEmailVerification}
                disabled
              />
            </div>
            <div className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
              <span>
                <Label>Função padrão do WordPress</Label>
                <span className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">Novas contas recebem apenas uma função sem privilégios administrativos.</span>
              </span>
              <Select
                value={settingsDraft.defaultRole}
                disabled={!canManageSettings}
                onValueChange={defaultRole => setSettingsDraft(current => ({ ...current, defaultRole }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="subscriber">Assinante</SelectItem>
                  <SelectItem value="customer">Cliente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div data-kodety-onboarding="members-account-routes" className="grid gap-3 rounded-xl border border-white/[0.08] p-4 sm:grid-cols-2">
            {([
              ['loginPageUrl', 'Página de login', '/entrar/'],
              ['accountPageUrl', 'Página da conta', '/minha-conta/'],
              ['upgradePageUrl', 'Página de upgrade', '/planos/'],
              ['resetPageUrl', 'Página de redefinição de senha', '/redefinir-senha/'],
              ['afterLoginUrl', 'Depois do login', '/minha-conta/'],
              ['afterLogoutUrl', 'Depois do logout', '/'],
            ] as const).map(([key, label, placeholder]) => (
              <label key={key} className={cn('grid gap-1.5', key === 'afterLogoutUrl' && 'sm:col-span-2')}>
                <Label>{label}</Label>
                <Input
                  value={settingsDraft[key]}
                  disabled={!canManageSettings}
                  placeholder={placeholder}
                  onChange={event => setSettingsDraft(current => ({ ...current, [key]: event.target.value }))}
                />
              </label>
            ))}
          </div>
          <div data-kodety-onboarding="members-retention" className="grid gap-3 rounded-xl border border-white/[0.08] p-4 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <Label>Retenção de auditoria (dias)</Label>
              <Input
                type="number"
                min={30}
                max={3650}
                value={settingsDraft.auditRetentionDays}
                disabled={!canManageSettings}
                onChange={event => setSettingsDraft(current => ({
                  ...current,
                  auditRetentionDays: Math.max(30, Math.min(3650, Number(event.target.value) || 30)),
                }))}
              />
            </label>
            <label className="grid gap-1.5">
              <Label>Retenção de eventos (dias)</Label>
              <Input
                type="number"
                min={30}
                max={3650}
                value={settingsDraft.eventRetentionDays}
                disabled={!canManageSettings}
                onChange={event => setSettingsDraft(current => ({
                  ...current,
                  eventRetentionDays: Math.max(30, Math.min(3650, Number(event.target.value) || 30)),
                }))}
              />
            </label>
            <p className="text-[9px] leading-4 text-muted-foreground sm:col-span-2">
              Projetos autorizados são gerenciados pela ativação versionada do Builder, não por edição manual desta lista.
            </p>
          </div>
          {!canManageSettings && (
            <p className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[10px] text-amber-100">
              Sua conta pode consultar esta área, mas não possui a capability para alterar configurações.
            </p>
          )}
          <div className="flex justify-end">
            <Button disabled={!canManageSettings || !settingsDirty || settingsSaving} onClick={() => void saveSettings()}>
              {settingsSaving ? <Loader2 className="animate-spin" /> : <Settings2 />}
              {settingsSaving ? 'Salvando…' : 'Salvar configurações'}
            </Button>
          </div>
        </>
      )}
    </section>
  );

  const body = !client ? (
    <EmptyState
      icon={ShieldAlert}
      title="Integração de membership indisponível"
      description="Configure membersOverviewUrl, membersUsersUrl, membersPlansUrl e membersSettingsUrl em window.kodetyWordPress, ou injete api/dataSource neste componente."
    />
  ) : overviewLoading && !overview ? (
    <div className="grid min-h-[50vh] place-items-center text-xs text-muted-foreground">
      <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Consultando WordPress…</span>
    </div>
  ) : overviewError && !overview ? (
    <EmptyState
      icon={ShieldAlert}
      title="Não foi possível consultar a Área de Membros"
      description={overviewError}
      action={<Button variant="secondary" onClick={() => void reloadOverview()}><RefreshCw /> Tentar novamente</Button>}
    />
  ) : !fullyEnabled ? (
    <ActivationPanel
      activating={activating}
      apiEnabled={Boolean(overview?.enabled)}
      canActivateProject={Boolean(onProjectEnabledChange)}
      canManageSettings={!readOnly && Boolean(overview?.capabilities.manageSettings)}
      error={activationError}
      onActivate={() => void activate()}
      projectEnabled={effectiveProjectEnabled}
      projectManaged={projectManaged}
    />
  ) : tab === 'members'
    ? membersContent
    : tab === 'plans'
      ? plansContent
      : tab === 'commerce' && commerceContent
        ? commerceContent
        : settingsContent;

  const managerContent = (
    <div data-kodety-onboarding="members-workspace" className="flex h-full min-h-0 flex-col bg-[#111] text-foreground">
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-white/[0.07] px-4">
        {logoMenu && <div className="-ml-4 shrink-0">{logoMenu}</div>}
        {backHref ? (
          <Button variant="ghost" size="icon-sm" asChild>
            <a href={backHref} aria-label="Voltar"><ArrowLeft /></a>
          </Button>
        ) : onOpenChange ? (
          <Button variant="ghost" size="icon-sm" aria-label="Fechar" onClick={() => onOpenChange(false)}>
            <ArrowLeft />
          </Button>
        ) : null}
        <span className="grid size-8 place-items-center rounded-xl bg-[var(--kodety-accent)]/10 text-[var(--kodety-accent-hover)]"><UsersRound className="size-4" /></span>
        <span className="min-w-0">
          <span className="block text-xs font-semibold">Área de Membros</span>
          <span className="block text-[9px] text-muted-foreground">Usuários, planos e autorização do site</span>
        </span>
        {fullyEnabled && <Badge variant="outline" className="ml-auto border-emerald-500/15 bg-emerald-500/[0.08] text-[8px] text-emerald-300">Ativa</Badge>}
      </header>
      {fullyEnabled && (
        <nav data-kodety-onboarding="members-navigation" aria-label="Seções da Área de Membros" className="flex shrink-0 gap-1 border-b border-white/[0.07] px-4 py-2">
          {tabs.map(item => (
            <Button
              key={item.value}
              data-kodety-onboarding={`members-${item.value}-tab`}
              data-kodety-onboarding-reveal
              data-kodety-onboarding-navigation
              aria-current={tab === item.value ? 'page' : undefined}
              variant={tab === item.value ? 'secondary' : 'ghost'}
              onClick={() => setTab(item.value)}
            >
              <item.icon /> {item.label}
            </Button>
          ))}
        </nav>
      )}
      <main data-kodety-onboarding="members-content" className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">{body}</main>

      <Dialog
        open={memberActions !== null}
        modal={!onboardingActive}
        onOpenChange={next => {
          if (!next && !memberActionLoading && !memberAccessChanging) {
            setMemberActions(null);
            setMemberActionLink(null);
          }
        }}
      >
        <DialogContent {...builderOnboardingDialogProps(onboardingActive)} data-kodety-onboarding-navigation-draft="member-access" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Acesso seguro do membro</DialogTitle>
            <DialogDescription>
              Gere links temporários apenas sob demanda. Senhas e tokens nunca são exibidos nem armazenados no projeto.
            </DialogDescription>
          </DialogHeader>
          {memberActions && (
            <div className="grid gap-3">
              <div className="rounded-xl border border-white/[0.08] p-3">
                <span className="block text-[10px] font-medium">{memberActions.displayName || 'Sem nome'}</span>
                <span className="block text-[9px] text-muted-foreground">{memberActions.email}</span>
              </div>
              {client?.changeMemberAccess && (
                <div data-kodety-onboarding="members-access-override" className="grid gap-3 rounded-xl border border-white/[0.08] p-3">
                  <div>
                    <Label>Adicionar ou remover acesso</Label>
                    <p className="mt-0.5 text-[9px] leading-4 text-muted-foreground">
                      Esta ação altera somente a autorização no site. Não cancela assinatura,
                      não estorna a venda e não movimenta saldo no provedor.
                    </p>
                  </div>
                  <Select value={memberActionPlanId || '__none'} onValueChange={value => setMemberActionPlanId(value === '__none' ? '' : value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Selecione um plano</SelectItem>
                      {plans.filter(plan => plan.status === 'active').map(plan => (
                        <SelectItem key={String(plan.id)} value={String(plan.id)}>{plan.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Textarea
                    rows={2}
                    maxLength={500}
                    value={memberActionReason}
                    placeholder="Motivo para auditoria · opcional"
                    onChange={event => setMemberActionReason(event.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={!canManageCommerce || !memberActionPlanId || Boolean(memberAccessChanging)}
                      onClick={() => void changeMemberAccess('grant')}
                    >
                      {memberAccessChanging === 'grant' ? <Loader2 className="animate-spin" /> : <UserRoundCheck />}
                      Adicionar acesso
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={!canManageCommerce || !memberActionPlanId || Boolean(memberAccessChanging)}
                      onClick={() => void changeMemberAccess('revoke')}
                    >
                      {memberAccessChanging === 'revoke' ? <Loader2 className="animate-spin" /> : <UserRoundX />}
                      Remover acesso
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!canManageCommerce || !memberActionPlanId || Boolean(memberAccessChanging)}
                      onClick={() => void changeMemberAccess('restore')}
                    >
                      {memberAccessChanging === 'restore' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                      Restaurar sincronização
                    </Button>
                  </div>
                </div>
              )}
              <div data-kodety-onboarding="members-access-links" className="grid gap-2 sm:grid-cols-3">
                <Button
                  variant="secondary"
                  disabled={!canManageCommerce || Boolean(memberActionLoading) || !client?.createMemberAccessLink}
                  onClick={() => void createMemberActionLink('access')}
                >
                  {memberActionLoading === 'access' ? <Loader2 className="animate-spin" /> : <KeyRound />}
                  Link de acesso
                </Button>
                <Button
                  variant="secondary"
                  disabled={!canManageCommerce || Boolean(memberActionLoading) || !client?.createMemberResetLink}
                  onClick={() => void createMemberActionLink('reset')}
                >
                  {memberActionLoading === 'reset' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  Redefinir senha
                </Button>
                <Button
                  variant="secondary"
                  disabled={!canManageCommerce || Boolean(memberActionLoading) || !client?.sendMemberResetEmail}
                  onClick={() => void sendMemberReset()}
                >
                  {memberActionLoading === 'email' ? <Loader2 className="animate-spin" /> : <Send />}
                  Enviar e-mail
                </Button>
              </div>
              {memberActionLink && (
                <div className="grid gap-2 rounded-xl border border-[var(--kodety-accent)]/15 bg-[var(--kodety-accent)]/[0.05] p-3">
                  <Label>{memberActionLink.label}</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={memberActionLink.url} />
                    <Button
                      size="icon-sm"
                      variant="secondary"
                      aria-label={`Copiar ${memberActionLink.label.toLocaleLowerCase()}`}
                      onClick={() => void copyMemberActionLink()}
                    ><Clipboard /></Button>
                  </div>
                  <span className="text-[9px] leading-4 text-muted-foreground">
                    {memberActionLink.expiresAt
                      ? `Expira em ${formatDate(memberActionLink.expiresAt)}.`
                      : 'O WordPress controla validade e uso único deste link.'}
                    {' '}Se houver dúvida sobre o destinatário, revogue o acesso e gere outro.
                  </span>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editingMember !== null} modal={!onboardingActive} onOpenChange={next => { if (!next && !memberSaving) setEditingMember(null); }}>
        <DialogContent {...builderOnboardingDialogProps(onboardingActive)} data-kodety-onboarding-navigation-draft="member" className="max-w-xl gap-0 overflow-hidden p-0">
          <DialogHeader className="m-0 border-b px-5 py-4">
            <DialogTitle>{editingMember === 'new' ? 'Adicionar membro' : 'Editar membro'}</DialogTitle>
            <DialogDescription>
              {editingMember === 'new' ? 'Crie a conta ou envie um convite com os acessos iniciais.' : 'Atualize o perfil, status e entitlements.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[65vh] gap-4 overflow-y-auto p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5"><Label>Nome</Label><Input value={memberDraft.displayName} onChange={event => setMemberDraft(current => ({ ...current, displayName: event.target.value }))} /></label>
              <label className="grid gap-1.5"><Label>E-mail</Label><Input type="email" value={memberDraft.email} disabled={editingMember !== 'new'} onChange={event => setMemberDraft(current => ({ ...current, email: event.target.value }))} /></label>
            </div>
            {editingMember !== 'new' && (
              <label className="grid gap-1.5">
                <Label>Status</Label>
                <Select value={memberDraft.status} onValueChange={status => setMemberDraft(current => ({ ...current, status: status as HtmlMembershipMemberStatus }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Ativo</SelectItem>
                    <SelectItem value="suspended">Suspenso</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            )}
            <div data-kodety-onboarding="members-member-plans" className="grid gap-2">
              <span><Label>Planos</Label><span className="mt-0.5 block text-[9px] text-muted-foreground">O WordPress transforma estes vínculos em entitlements autoritativos.</span></span>
              <PlanChecks
                disabled={!canAssignPlans}
                plans={plans}
                value={memberDraft.planKeys}
                onChange={planKeys => setMemberDraft(current => ({ ...current, planKeys }))}
              />
              {!canAssignPlans && (
                <span className="text-[9px] text-amber-200">
                  Sua conta pode editar o membro, mas não possui permissão para atribuir planos.
                </span>
              )}
            </div>
            {editingMember === 'new' && (
              <>
                <div className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.08] p-3">
                  <span><Label>Enviar convite</Label><span className="mt-0.5 block text-[9px] text-muted-foreground">O membro define a senha por um link temporário.</span></span>
                  <Switch checked={memberDraft.sendInvite} onCheckedChange={sendInvite => setMemberDraft(current => ({ ...current, sendInvite, password: '' }))} />
                </div>
                {!memberDraft.sendInvite && (
                  <label className="grid gap-1.5">
                    <Label>Senha inicial</Label>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      value={memberDraft.password}
                      onChange={event => setMemberDraft(current => ({ ...current, password: event.target.value }))}
                    />
                    <span className="text-[9px] text-muted-foreground">Use pelo menos 12 caracteres. A senha é enviada somente ao WordPress e não entra no projeto.</span>
                  </label>
                )}
              </>
            )}
          </div>
          <DialogFooter className="border-t px-5 py-3">
            <Button variant="secondary" disabled={memberSaving} onClick={() => setEditingMember(null)}>Cancelar</Button>
            <Button disabled={memberSaving} onClick={() => void saveMember()}>
              {memberSaving ? <Loader2 className="animate-spin" /> : editingMember === 'new' && memberDraft.sendInvite ? <Mail /> : <CircleUserRound />}
              {memberSaving ? 'Salvando…' : editingMember === 'new' && memberDraft.sendInvite ? 'Enviar convite' : 'Salvar membro'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editingPlan !== null} modal={!onboardingActive} onOpenChange={next => { if (!next && !planSaving) setEditingPlan(null); }}>
        <DialogContent {...builderOnboardingDialogProps(onboardingActive)} data-kodety-onboarding-navigation-draft="member-plan" className="max-w-xl gap-0 overflow-hidden p-0">
          <DialogHeader className="m-0 border-b px-5 py-4">
            <DialogTitle>{editingPlan === 'new' ? 'Novo plano' : 'Editar plano'}</DialogTitle>
            <DialogDescription>A chave liga Builder, WordPress e provedores externos. Evite alterá-la depois de publicar regras.</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[65vh] gap-4 overflow-y-auto p-5">
            <div data-kodety-onboarding="members-plan-identity" className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5"><Label>Nome</Label><Input value={planDraft.name} placeholder="Plano Pro" onChange={event => setPlanDraft(current => ({ ...current, name: event.target.value }))} /></label>
              <label className="grid gap-1.5"><Label>Chave estável</Label><Input value={planDraft.key} disabled={editingPlan !== 'new'} placeholder="pro" onChange={event => setPlanDraft(current => ({ ...current, key: normalizeMembershipPlanKey(event.target.value) }))} /></label>
            </div>
            <label className="grid gap-1.5"><Label>Descrição</Label><Textarea value={planDraft.description || ''} rows={3} onChange={event => setPlanDraft(current => ({ ...current, description: event.target.value }))} /></label>
            <label data-kodety-onboarding="members-plan-status" className="grid gap-1.5">
              <Label>Status</Label>
              <Select value={planDraft.status} onValueChange={status => setPlanDraft(current => ({ ...current, status: status as HtmlMembershipPlanStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="draft">Rascunho</SelectItem>
                  <SelectItem value="archived">Arquivado</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label data-kodety-onboarding="members-plan-upgrade" className="grid gap-1.5"><Label>URL de upgrade</Label><Input value={planDraft.upgradeUrl || ''} placeholder="/planos/pro/" onChange={event => setPlanDraft(current => ({ ...current, upgradeUrl: event.target.value }))} /></label>
            <div data-kodety-onboarding="members-plan-provider" className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5"><Label>Provedor</Label><Input value={planDraft.provider || ''} placeholder="manual, shopify…" onChange={event => setPlanDraft(current => ({ ...current, provider: event.target.value }))} /></label>
              <label className="grid gap-1.5"><Label>ID externo</Label><Input value={planDraft.externalId || ''} placeholder="gid://shopify/…" onChange={event => setPlanDraft(current => ({ ...current, externalId: event.target.value }))} /></label>
            </div>
          </div>
          <DialogFooter className="border-t px-5 py-3">
            <Button variant="secondary" disabled={planSaving} onClick={() => setEditingPlan(null)}>Cancelar</Button>
            <Button disabled={planSaving} onClick={() => void savePlan()}>
              {planSaving ? <Loader2 className="animate-spin" /> : <Layers3 />}
              {planSaving ? 'Salvando…' : 'Salvar plano'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteMember !== null}
        onOpenChange={next => { if (!next) setDeleteMember(null); }}
        title="Suspender acesso?"
        description={`A conta ${deleteMember?.email || ''} continuará no WordPress, mas ficará suspensa e perderá os planos atuais. O acesso pode ser restaurado editando o membro.`}
        confirmLabel="Suspender acesso"
        onConfirm={removeMember}
      />
      <ConfirmDialog
        open={archivePlan !== null}
        onOpenChange={next => { if (!next) setArchivePlan(null); }}
        title="Arquivar plano?"
        description="O plano sai das novas seleções, mas sua chave permanece reconhecível em regras e históricos existentes."
        confirmLabel="Arquivar plano"
        onConfirm={archiveSelectedPlan}
      />
    </div>
  );

  if (!open) return null;
  if (standalone) {
    return <div className="h-full min-h-0 overflow-hidden bg-background">{managerContent}</div>;
  }
  return (
    <Dialog open={open} modal={!onboardingActive} onOpenChange={next => onOpenChange?.(next)}>
      <DialogContent {...builderOnboardingDialogProps(onboardingActive)} variant="side" showCloseButton={false} className="h-dvh w-screen max-w-none gap-0 overflow-hidden border-0 p-0 sm:w-screen">
        {managerContent}
      </DialogContent>
    </Dialog>
  );
}
