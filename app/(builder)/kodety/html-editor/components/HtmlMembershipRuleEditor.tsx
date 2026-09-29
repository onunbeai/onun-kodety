'use client';

import { useMemo } from 'react';
import {
  Check,
  CircleUserRound,
  Download,
  Eye,
  EyeOff,
  LockKeyhole,
  LogIn,
  RotateCcw,
  ShieldAlert,
} from '@/components/ui/gravity-icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  evaluateMembershipRule,
  membershipActivePlanKeys,
  normalizeMembershipAccessRule,
  normalizeMembershipPlanKey,
  type MembershipAccessRequirement,
  type MembershipAccessRule,
  type MembershipEvaluation,
  type MembershipFallback,
  type MembershipPlanOption,
  type MembershipViewerContext,
} from '@/lib/html-editor/membership';
import { cn } from '@/lib/utils';

export interface HtmlMembershipRuleEditorProps {
  value: MembershipAccessRule;
  plans: readonly MembershipPlanOption[];
  plansError?: string;
  onChange: (value: MembershipAccessRule) => void;
  disabled?: boolean;
  compact?: boolean;
  membershipEnabled?: boolean;
  title?: string;
}

export interface HtmlMembershipPreviewSelectorProps {
  plans: readonly MembershipPlanOption[];
  plansError?: string;
  value: MembershipViewerContext;
  onChange: (value: MembershipViewerContext) => void;
  disabled?: boolean;
  className?: string;
  hasOverrides?: boolean;
  onResetOverrides?: () => void;
}

export interface HtmlMembershipEvaluationBadgeProps {
  evaluation: MembershipEvaluation;
  className?: string;
}

export interface HtmlMembershipProtectedDownloadControlProps {
  checked: boolean;
  eligible: boolean;
  localPath?: string;
  scopeLabel?: string;
  reason?: string;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}

const accessOptions: Array<{
  value: 'public' | 'authenticated' | 'plans';
  label: string;
  description: string;
}> = [
  { value: 'public', label: 'Público', description: 'Qualquer visitante pode acessar.' },
  { value: 'authenticated', label: 'Membros logados', description: 'Exige uma sessão válida.' },
  { value: 'plans', label: 'Planos específicos', description: 'Exige um ou mais planos.' },
];

function requirementType(requirement: MembershipAccessRequirement) {
  return requirement.type === 'invalid' ? 'authenticated' : requirement.type;
}

function fallbackValue(fallback: MembershipFallback) {
  if (fallback.type === 'branch') return `branch:${fallback.branch}`;
  return fallback.type;
}

function FallbackEditor({
  compact,
  disabled,
  fallback,
  label,
  onChange,
}: {
  compact: boolean;
  disabled: boolean;
  fallback: MembershipFallback;
  label: string;
  onChange: (value: MembershipFallback) => void;
}) {
  return (
    <div className={cn(
      'grid min-w-0 border-t border-border/60',
      compact
        ? 'gap-1.5 pt-2.5'
        : 'grid-cols-[minmax(0,1fr)_minmax(160px,0.9fr)] items-start gap-3 pt-3',
    )}>
      <span className="min-w-0">
        <Label className="text-[10px]">{label}</Label>
        {!compact && (
          <span className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">
            Escolha o que será exibido sem entregar o conteúdo protegido.
          </span>
        )}
      </span>
      <span className="grid min-w-0 gap-1.5">
        <Select
          disabled={disabled}
          value={fallbackValue(fallback)}
          onValueChange={value => {
            if (value === 'hide') onChange({ type: 'hide' });
            else if (value === 'redirect') onChange({ type: 'redirect', url: '' });
            else onChange({
              type: 'branch',
              branch: value === 'branch:upgrade' ? 'upgrade' : 'guest',
            });
          }}
        >
          <SelectTrigger
            size={compact ? 'xs' : 'default'}
            className={cn('w-full', compact && 'h-8 rounded-[7px] text-[10px]')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="branch:guest">Exibir branch de login</SelectItem>
            <SelectItem value="branch:upgrade">Exibir branch de upgrade</SelectItem>
            <SelectItem value="hide">Não exibir nada</SelectItem>
            <SelectItem value="redirect">Redirecionar</SelectItem>
          </SelectContent>
        </Select>
        {fallback.type === 'redirect' && (
          <Input
            disabled={disabled}
            value={fallback.url}
            placeholder="/login/ ou https://…"
            aria-label={`${label}: URL de redirect`}
            onChange={event => onChange({ type: 'redirect', url: event.target.value })}
          />
        )}
      </span>
    </div>
  );
}

function PlanToggle({
  active,
  disabled,
  name,
  onClick,
  planKey,
  status,
}: {
  active: boolean;
  disabled: boolean;
  name: string;
  onClick: () => void;
  planKey: string;
  status?: string;
}) {
  const unavailable = status !== undefined && status !== 'active';
  return (
    <button
      type="button"
      disabled={disabled || unavailable}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex min-h-9 w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? 'border-[var(--kodety-accent)]/35 bg-[var(--kodety-accent)]/10 text-foreground'
          : 'border-border/70 bg-white/[0.025] text-muted-foreground hover:bg-white/[0.05] hover:text-foreground',
      )}
    >
      <span className={cn(
        'grid size-4 shrink-0 place-items-center rounded border',
        active ? 'border-[var(--kodety-accent-hover)]/35 bg-[var(--kodety-accent)]/14 text-[var(--kodety-accent-hover)]' : 'border-border bg-transparent',
      )}>
        {active && <Check className="size-2.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[10px] font-medium">{name}</span>
        <span className="block truncate font-mono text-[8px] text-muted-foreground">{planKey}</span>
      </span>
      {unavailable && (
        <Badge variant="outline" className="px-1 py-0 text-[8px]">
          {status === 'draft' ? 'Rascunho' : 'Arquivado'}
        </Badge>
      )}
    </button>
  );
}

export function HtmlMembershipProtectedDownloadControl({
  checked,
  eligible,
  localPath,
  scopeLabel,
  reason,
  disabled = false,
  onCheckedChange,
}: HtmlMembershipProtectedDownloadControlProps) {
  const activationBlocked = !eligible && !checked;
  return (
    <section className="overflow-hidden rounded-xl border border-border/70 bg-white/[0.018] p-3">
      <div className="flex items-start gap-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-violet-300">
          <Download className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-foreground">Download protegido</span>
          <span className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">
            Marca este link para entrega privada pelo runtime de Membership.
          </span>
        </span>
        <Switch
          checked={checked}
          disabled={disabled || activationBlocked}
          aria-label="Marcar link como download protegido"
          onCheckedChange={onCheckedChange}
        />
      </div>
      <div className={cn(
        'mt-3 rounded-lg border px-2.5 py-2 text-[9px] leading-4',
        eligible
          ? 'border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-100'
          : 'border-amber-500/20 bg-amber-500/[0.06] text-amber-100',
      )}>
        {eligible ? (
          <>
            <span className="block font-medium">Arquivo local confirmado</span>
            <code className="mt-0.5 block break-all text-[8px] text-emerald-200">{localPath}</code>
            {scopeLabel && <span className="mt-1 block text-emerald-200/75">{scopeLabel}</span>}
          </>
        ) : (
          <span>{reason || 'Use um arquivo local dentro de uma área protegida.'}</span>
        )}
      </div>
      <p className="mt-2 text-[9px] leading-4 text-muted-foreground">
        URLs externas, links dinâmicos e arquivos ausentes não podem ser marcados.
        Desmarcar continua disponível para corrigir um marcador inválido.
        Se este arquivo já foi publicado ou distribuído antes, substitua-o por
        um novo arquivo: nenhuma plataforma consegue revogar cópias já baixadas
        ou mantidas em caches externos.
      </p>
    </section>
  );
}

export function HtmlMembershipRuleEditor({
  value,
  plans,
  plansError = '',
  onChange,
  disabled = false,
  compact = false,
  membershipEnabled = true,
  title = 'Controle de acesso',
}: HtmlMembershipRuleEditorProps) {
  const rule = useMemo(() => normalizeMembershipAccessRule(value), [value]);
  const type = requirementType(rule.requirement);
  const selectedPlanKeys = rule.requirement.type === 'plans'
    ? rule.requirement.planKeys
    : [];
  const knownKeys = new Set(plans.map(plan => plan.key));
  const missingKeys = selectedPlanKeys.filter(key => !knownKeys.has(key));

  const changeRequirement = (next: MembershipAccessRequirement) => {
    onChange({ ...rule, requirement: next });
  };
  const changeRequirementType = (nextType: 'public' | 'authenticated' | 'plans') => {
    if (nextType === 'public') changeRequirement({ type: 'public' });
    else if (nextType === 'authenticated') changeRequirement({ type: 'authenticated' });
    else changeRequirement({
      type: 'plans',
      match: rule.requirement.type === 'plans' ? rule.requirement.match : 'any',
      planKeys: selectedPlanKeys,
    });
  };
  const togglePlan = (rawKey: string) => {
    const key = normalizeMembershipPlanKey(rawKey);
    const next = selectedPlanKeys.includes(key)
      ? selectedPlanKeys.filter(item => item !== key)
      : [...selectedPlanKeys, key];
    changeRequirement({
      type: 'plans',
      match: rule.requirement.type === 'plans' ? rule.requirement.match : 'any',
      planKeys: next,
    });
  };

  return (
    <section className={cn(
      'overflow-hidden rounded-xl border border-border/70 bg-white/[0.018]',
      compact ? 'rounded-lg p-2.5' : 'p-4',
    )}>
      <div className={cn('flex items-start', compact ? 'gap-2' : 'gap-2.5')}>
        <span className={cn(
          'grid shrink-0 place-items-center bg-[var(--kodety-accent)]/10 text-[var(--kodety-accent-hover)]',
          compact ? 'size-6 rounded-md' : 'size-7 rounded-lg',
        )}>
          <LockKeyhole className={compact ? 'size-3' : 'size-3.5'} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block font-semibold text-foreground', compact ? 'text-[11px]' : 'text-xs')}>
            {title}
          </span>
          {!compact && (
            <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
              A autorização real é resolvida pelo WordPress antes de entregar o conteúdo.
            </span>
          )}
        </span>
      </div>

      {!membershipEnabled && (
        <div role="status" className={cn(
          'mt-3 flex gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.07] text-amber-100',
          compact ? 'p-2' : 'p-2.5',
        )}>
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
          <p className="text-[10px] leading-4">
            Membership ainda não está ativo no projeto. Regras protegidas falham fechado até a ativação.
          </p>
        </div>
      )}

      <div className={cn('grid gap-2', compact ? 'mt-3' : 'mt-4')}>
        <Label className="text-[10px]">Quem pode acessar</Label>
        {compact ? (
          <Select
            disabled={disabled}
            value={type}
            onValueChange={nextType => changeRequirementType(
              nextType === 'public' || nextType === 'plans' ? nextType : 'authenticated',
            )}
          >
            <SelectTrigger size="xs" className="h-8 w-full rounded-[7px] text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accessOptions.map(option => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
        <div className="grid gap-1.5 sm:grid-cols-3">
          {accessOptions.map(option => {
            const active = type === option.value;
            const Icon = option.value === 'public'
              ? Eye
              : option.value === 'authenticated'
                ? CircleUserRound
                : LockKeyhole;
            return (
              <button
                key={option.value}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => changeRequirementType(option.value)}
                className={cn(
                  'min-h-20 rounded-lg border p-2.5 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
                  active
                    ? 'border-[var(--kodety-accent-hover)]/35 bg-[var(--kodety-accent)]/10'
                    : 'border-border/60 bg-white/[0.018] hover:bg-white/[0.045]',
                )}
              >
                <Icon className={cn('size-3.5', active ? 'text-[var(--kodety-accent-hover)]' : 'text-muted-foreground')} />
                <span className="mt-2 block text-[10px] font-medium text-foreground">{option.label}</span>
                <span className="mt-0.5 block text-[9px] leading-3 text-muted-foreground">{option.description}</span>
              </button>
            );
          })}
        </div>
        )}
      </div>

      {type === 'plans' && (
        <div className={cn(
          'grid border-t border-border/60',
          compact ? 'mt-3 gap-2 pt-2.5' : 'mt-4 gap-3 pt-3',
        )}>
          <div className={cn(
            'grid',
            compact
              ? 'gap-1.5'
              : 'grid-cols-[minmax(0,1fr)_150px] items-center gap-2',
          )}>
            <span>
              <Label className="text-[10px]">Planos necessários</Label>
              {!compact && (
                <span className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">
                  Use “todos” apenas quando a pessoa precisar acumular mais de um plano.
                </span>
              )}
            </span>
            <Select
              disabled={disabled}
              value={rule.requirement.type === 'plans' ? rule.requirement.match : 'any'}
              onValueChange={match => changeRequirement({
                type: 'plans',
                match: match === 'all' ? 'all' : 'any',
                planKeys: selectedPlanKeys,
              })}
            >
              <SelectTrigger
                size={compact ? 'xs' : 'default'}
                className={compact ? 'h-8 rounded-[7px] text-[10px]' : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Qualquer plano</SelectItem>
                <SelectItem value="all">Todos os planos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className={cn('grid', compact ? 'gap-1' : 'grid-cols-2 gap-1.5')}>
            {plans.map(plan => (
              <PlanToggle
                key={plan.key}
                active={selectedPlanKeys.includes(plan.key)}
                disabled={disabled}
                name={plan.name}
                planKey={plan.key}
                status={plan.status}
                onClick={() => togglePlan(plan.key)}
              />
            ))}
          </div>
          {plansError ? (
            <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-[10px] text-red-200">
              {plansError}
            </p>
          ) : !plans.length && (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[10px] text-muted-foreground">
              Crie um plano na área de Membros antes de finalizar esta regra.
            </p>
          )}
          {missingKeys.length > 0 && (
            <div role="alert" className="rounded-lg border border-red-500/20 bg-red-500/[0.06] p-2.5">
              <p className="text-[10px] font-medium text-red-200">Planos indisponíveis</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {missingKeys.map(key => (
                  <button
                    key={key}
                    type="button"
                    disabled={disabled}
                    className="rounded-md bg-red-500/10 px-1.5 py-1 font-mono text-[9px] text-red-200 hover:bg-red-500/20"
                    onClick={() => togglePlan(key)}
                    title="Remover da regra"
                  >
                    {key} ×
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {type !== 'public' && (
        <div className={cn('grid', compact ? 'mt-3 gap-2.5' : 'mt-4 gap-3')}>
          <FallbackEditor
            compact={compact}
            disabled={disabled}
            fallback={rule.anonymous}
            label="Visitante não logado"
            onChange={anonymous => onChange({ ...rule, anonymous })}
          />
          {type === 'plans' && (
            <FallbackEditor
              compact={compact}
              disabled={disabled}
              fallback={rule.denied}
              label="Membro sem o plano"
              onChange={denied => onChange({ ...rule, denied })}
            />
          )}
        </div>
      )}
    </section>
  );
}

export function HtmlMembershipPreviewSelector({
  plans,
  plansError = '',
  value,
  onChange,
  disabled = false,
  className,
  hasOverrides = false,
  onResetOverrides,
}: HtmlMembershipPreviewSelectorProps) {
  const activeKeys = membershipActivePlanKeys(value);
  const state = value.previewLayer === 'base'
    ? 'base'
    : !value.authenticated
      ? 'guest'
      : activeKeys.length
        ? 'plans'
        : 'member';
  const activePlans = plans.filter(plan => plan.status === undefined || plan.status === 'active');
  const togglePlan = (rawKey: string) => {
    const key = normalizeMembershipPlanKey(rawKey);
    const next = activeKeys.includes(key)
      ? activeKeys.filter(item => item !== key)
      : [...activeKeys, key];
    onChange({
      authenticated: true,
      planKeys: next,
      previewLayer: next.length
        ? `plan:${next.includes(key) ? key : next[0]}`
        : 'member',
    });
  };
  return (
    <section className={cn('rounded-xl border border-border/70 bg-white/[0.018] px-5 py-4', className)}>
      <div className="flex items-start gap-2">
        <Eye className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <Label className="text-[10px]">Visualizar como</Label>
          <span className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">
            Base edita todos. Os outros modos gravam uma camada visual própria.
          </span>
        </span>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2">
        <Button
          size="xs"
          variant={state === 'base' ? 'secondary' : 'ghost'}
          disabled={disabled}
          onClick={() => onChange({ authenticated: true, planKeys: [], previewLayer: 'base' })}
        >
          <CircleUserRound /> Base
        </Button>
        <Button
          size="xs"
          variant={state === 'guest' ? 'secondary' : 'ghost'}
          disabled={disabled}
          onClick={() => onChange({ authenticated: false, previewLayer: 'guest' })}
        >
          <EyeOff /> Visitante
        </Button>
        <Button
          size="xs"
          variant={state === 'member' ? 'secondary' : 'ghost'}
          disabled={disabled}
          onClick={() => onChange({ authenticated: true, planKeys: [], previewLayer: 'member' })}
        >
          <LogIn /> Membro
        </Button>
        <Button
          size="xs"
          variant={state === 'plans' ? 'secondary' : 'ghost'}
          disabled={disabled || !activePlans.length}
          onClick={() => onChange({
            authenticated: true,
            planKeys: activeKeys.length ? activeKeys : activePlans[0] ? [activePlans[0].key] : [],
            previewLayer: activeKeys.length
              ? value.previewLayer
              : activePlans[0]
                ? `plan:${activePlans[0].key}`
                : 'member',
          })}
        >
          <LockKeyhole /> Planos
        </Button>
      </div>
      {state === 'plans' && (
        <div className="mt-2 flex flex-wrap gap-1">
          {activePlans.map(plan => (
            <button
              key={plan.key}
              type="button"
              disabled={disabled}
              aria-pressed={activeKeys.includes(plan.key)}
              className={cn(
                'rounded-md border px-1.5 py-1 text-[9px] outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50',
                activeKeys.includes(plan.key)
                  ? 'border-[var(--kodety-accent)]/35 bg-[var(--kodety-accent)]/10 text-[var(--kodety-accent-hover)]'
                  : 'border-border/70 text-muted-foreground hover:bg-white/[0.05]',
              )}
              onClick={() => togglePlan(plan.key)}
            >
              {activeKeys.includes(plan.key) && <Check className="mr-1 inline size-2.5" />}
              {plan.name}
            </button>
          ))}
        </div>
      )}
      {plansError && (
        <p role="alert" className="mt-2 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-2 py-1.5 text-[9px] text-red-200">
          {plansError}
        </p>
      )}
      {state !== 'base' && hasOverrides && onResetOverrides && (
        <Button
          size="xs"
          variant="ghost"
          className="mt-2 w-full justify-start text-muted-foreground"
          disabled={disabled}
          onClick={onResetOverrides}
        >
          <RotateCcw /> Limpar camada desta página
        </Button>
      )}
    </section>
  );
}

export function HtmlMembershipEvaluationBadge({
  evaluation,
  className,
}: HtmlMembershipEvaluationBadgeProps) {
  const label = evaluation.allowed
    ? evaluation.state === 'public' ? 'Público' : 'Autorizado'
    : evaluation.state === 'misconfigured'
      ? 'Bloqueado por segurança'
      : evaluation.fallback?.type === 'redirect'
        ? 'Redireciona'
        : evaluation.fallback?.type === 'hide'
          ? 'Oculto'
          : evaluation.fallback?.type === 'branch'
            ? evaluation.fallback.branch === 'upgrade'
              ? 'Exibe upgrade'
              : 'Exibe login'
            : 'Bloqueado';
  const tone = evaluation.allowed
    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
    : evaluation.state === 'misconfigured'
      ? 'border-red-500/20 bg-red-500/10 text-red-200'
      : 'border-amber-500/20 bg-amber-500/10 text-amber-200';
  return <Badge variant="outline" className={cn('px-1.5 py-0 text-[9px]', tone, className)}>{label}</Badge>;
}

export function HtmlMembershipRulePreview({
  enabled = true,
  rule,
  viewer,
}: {
  enabled?: boolean;
  rule: MembershipAccessRule;
  viewer: MembershipViewerContext;
}) {
  const evaluation = evaluateMembershipRule(rule, viewer, { enabled });
  return <HtmlMembershipEvaluationBadge evaluation={evaluation} />;
}
