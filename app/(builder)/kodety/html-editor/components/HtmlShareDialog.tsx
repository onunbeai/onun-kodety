'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ArrowUp, Check, Copy, Link2, Loader2, Lock, Mail, RefreshCw, Trash2, Users, X } from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { getAdminUiLocale } from '@/lib/admin-ui-locale';

export interface ShareAccessInvitation {
  email: string;
  permission: 'view' | 'edit';
  token: string;
  accountExists: boolean;
  accepted: boolean;
  acceptUrl: string;
  loginUrl: string;
  lostPasswordUrl: string;
}

interface ShareInvitation {
  email: string;
  permission: 'view' | 'edit';
  invitedAt?: string;
  accepted: boolean;
  acceptedAt?: string;
}

interface ShareState {
  enabled: boolean;
  permission: 'view' | 'edit';
  authRequired: boolean;
  url: string;
  updatedAt?: string;
  invitations: ShareInvitation[];
}

const EMPTY_SHARE: ShareState = {
  enabled: false,
  permission: 'view',
  authRequired: false,
  url: '',
  invitations: [],
};

const SHARE_MODAL_OVERLAY_CLASS = 'z-[11000] bg-black/70 backdrop-blur-[2px]';
const SHARE_MODAL_CONTENT_CLASS =
  'z-[11010] max-h-[calc(100dvh-24px)] gap-0 overflow-hidden rounded-[18px] border-white/[.08] bg-[var(--kodety-panel-raised)] p-0 shadow-[var(--kodety-shadow-popover)]';
const SHARE_SELECT_CONTENT_CLASS =
  'z-[11020] rounded-[10px] border-white/[.08] bg-[var(--kodety-panel)] p-1 shadow-[var(--kodety-shadow-popover)]';

function ShareActionTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="top"
        className="z-[11020] border border-white/[.08] [--tooltip-surface:var(--kodety-panel)] text-[var(--kodety-text)] shadow-[var(--kodety-shadow-popover)]"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function initials(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words.at(-1)?.[0] || ''}` : words[0]?.slice(0, 2) || '?').toUpperCase();
}

export function HtmlInvitationAccessDialog({
  invitation,
  open,
  onOpenChange,
}: {
  invitation: ShareAccessInvitation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const accept = async () => {
    if (password.length < 8) {
      toast.error('Crie uma senha com pelo menos 8 caracteres.');
      return;
    }
    if (password !== confirmation) {
      toast.error('As senhas não coincidem.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(invitation.acceptUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invitationToken: invitation.token,
          displayName: displayName.trim(),
          password,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload?.code === 'kodety_invitation_account_exists' && payload?.data?.loginUrl) {
          window.location.assign(payload.data.loginUrl);
          return;
        }
        throw new Error(payload?.message || 'Não foi possível ativar a edição.');
      }
      toast.success('Conta criada. Abrindo o editor…');
      window.location.assign(payload?.reloadUrl || window.location.href);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível ativar a edição.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName={SHARE_MODAL_OVERLAY_CLASS}
        className={`${SHARE_MODAL_CONTENT_CLASS} w-[440px] max-w-[calc(100vw-24px)]`}
        showCloseButton={false}
      >
        <div className="flex items-start gap-3 px-5 pb-4 pt-5">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[10px] border border-[var(--kodety-accent)]/25 bg-[var(--kodety-accent)]/10 text-[var(--kodety-accent-hover)]">
            <Lock className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[16px] font-semibold tracking-[-0.02em] text-white">Ativar acesso de edição</DialogTitle>
            <DialogDescription className="mt-1 text-[12px] leading-5 text-zinc-400">
              Convite enviado para <span className="font-medium text-zinc-200">{invitation.email}</span>
            </DialogDescription>
          </div>
          <ShareActionTooltip label="Continuar somente visualizando">
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="size-7 rounded-[7px] text-[var(--kodety-text-tertiary)] hover:bg-white/[.065] hover:text-[var(--kodety-text)] focus-visible:text-[var(--kodety-accent-hover)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]"
              onClick={() => onOpenChange(false)}
              aria-label="Continuar somente visualizando"
            >
              <X />
            </Button>
          </ShareActionTooltip>
        </div>

        <div className="border-t border-white/[0.08] px-5 py-5">
          {invitation.accountExists ? (
            <div className="space-y-4">
              <p className="text-[12px] leading-5 text-zinc-400">
                Este email já possui uma conta. Entre com sua senha para liberar a edição deste projeto.
              </p>
              <Button className="h-9 w-full rounded-[9px] bg-[var(--kodety-accent)] text-[12px] text-white hover:bg-[var(--kodety-accent-hover)]" asChild>
                <a href={invitation.loginUrl}>Entrar e editar</a>
              </Button>
              <a className="block text-center text-[11px] text-zinc-500 transition-colors hover:text-zinc-300" href={invitation.lostPasswordUrl}>Esqueci minha senha</a>
            </div>
          ) : (
            <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void accept(); }}>
              <p className="pb-1 text-[12px] leading-5 text-zinc-400">
                Crie sua senha uma única vez. Nos próximos acessos, basta entrar com este email.
              </p>
              <Input
                value={displayName}
                onChange={event => setDisplayName(event.target.value)}
                placeholder="Seu nome"
                autoComplete="name"
                className="h-9 rounded-[9px] border-transparent bg-white/[.055] text-[12px] hover:bg-white/[.07] focus-visible:border-[var(--kodety-focus)]/75 focus-visible:bg-white/[.075] focus-visible:ring-0"
              />
              <Input
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="Crie uma senha (mínimo 8 caracteres)"
                autoComplete="new-password"
                className="h-9 rounded-[9px] border-transparent bg-white/[.055] text-[12px] hover:bg-white/[.07] focus-visible:border-[var(--kodety-focus)]/75 focus-visible:bg-white/[.075] focus-visible:ring-0"
                autoFocus
              />
              <Input
                type="password"
                value={confirmation}
                onChange={event => setConfirmation(event.target.value)}
                placeholder="Confirme a senha"
                autoComplete="new-password"
                className="h-9 rounded-[9px] border-transparent bg-white/[.055] text-[12px] hover:bg-white/[.07] focus-visible:border-[var(--kodety-focus)]/75 focus-visible:bg-white/[.075] focus-visible:ring-0"
              />
              <Button type="submit" disabled={submitting} className="h-9 w-full rounded-[9px] bg-[var(--kodety-accent)] text-[12px] text-white hover:bg-[var(--kodety-accent-hover)]">
                {submitting ? <><Loader2 className="animate-spin" /> Ativando…</> : 'Criar senha e editar'}
              </Button>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function HtmlShareDialog({
  open,
  onOpenChange,
  endpoint,
  nonce,
  projectName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endpoint: string;
  nonce: string;
  projectName: string;
}) {
  const englishUi = getAdminUiLocale().toLowerCase().startsWith('en');
  const [share, setShare] = useState<ShareState>(EMPTY_SHARE);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState('');
  const [invitePermission, setInvitePermission] = useState<'view' | 'edit'>('edit');

  const load = async (signal?: AbortSignal) => {
    const response = await fetch(endpoint, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-WP-Nonce': nonce },
      signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.message || 'Não foi possível carregar os convites.');
    setShare({ ...EMPTY_SHARE, ...payload, invitations: Array.isArray(payload?.invitations) ? payload.invitations : [] });
  };

  useEffect(() => {
    if (!open || !endpoint) return;
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal)
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        toast.error(error instanceof Error ? error.message : 'Não foi possível carregar os convites.');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, nonce, open]);

  const save = async (next: ShareState, regenerate = false) => {
    setSaving(true);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
        body: JSON.stringify({ ...next, regenerate }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível atualizar o link.');
      setShare({ ...EMPTY_SHARE, ...payload, invitations: payload?.invitations || [] });
      toast.success(regenerate ? 'Novo link criado' : 'Acesso do link atualizado');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível atualizar o link.');
    } finally {
      setSaving(false);
    }
  };

  const invite = async () => {
    if (saving) return;
    const normalized = email.trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) {
      toast.error('Informe um email válido.');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`${endpoint.replace(/\/$/, '')}/invitations`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
        body: JSON.stringify({ email: normalized, permission: invitePermission }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível enviar o convite.');
      setShare({ ...EMPTY_SHARE, ...(payload?.share || {}), invitations: payload?.share?.invitations || [] });
      setEmail('');
      toast.success(payload?.sent === false ? 'Acesso criado; o servidor não enviou o email' : 'Convite enviado');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível enviar o convite.');
    } finally {
      setSaving(false);
    }
  };

  const removeInvitation = async (invitationEmail: string) => {
    setSaving(true);
    try {
      const response = await fetch(`${endpoint.replace(/\/$/, '')}/invitations`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
        body: JSON.stringify({ email: invitationEmail }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível remover o convite.');
      setShare({ ...EMPTY_SHARE, ...payload, invitations: payload?.invitations || [] });
      toast.success('Convite removido');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível remover o convite.');
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = async () => {
    if (!share.url) return;
    await navigator.clipboard.writeText(share.url);
    toast.success('Link copiado');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName={SHARE_MODAL_OVERLAY_CLASS}
        className={`${SHARE_MODAL_CONTENT_CLASS} w-[575px] max-w-[calc(100vw-24px)]`}
        showCloseButton={false}
      >
        <div className="flex min-h-14 items-center border-b border-white/[.065] px-5">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[17px] font-semibold tracking-[-0.02em] text-white">Convidar</DialogTitle>
            <DialogDescription className="sr-only">Convide pessoas e gerencie quem está no projeto.</DialogDescription>
          </div>
          <ShareActionTooltip label="Fechar">
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="size-7 rounded-[7px] text-[var(--kodety-text-tertiary)] hover:bg-white/[.065] hover:text-[var(--kodety-text)] focus-visible:text-[var(--kodety-accent-hover)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]"
              onClick={() => onOpenChange(false)}
              aria-label="Fechar"
            >
              <X />
            </Button>
          </ShareActionTooltip>
        </div>

        {loading ? (
          <div className="grid min-h-80 place-items-center"><Loader2 className="size-4 animate-spin text-zinc-500" /></div>
        ) : (
          <div className="kodety-compact-scrollbar space-y-0 overflow-y-auto px-4 pb-4 pt-3">
            <div className="rounded-[12px] border border-white/[.07] bg-black/[.07] p-2.5">
              <div
                data-kodety-share-invite-control
                className="group/share-invite flex h-9 min-w-0 items-stretch overflow-hidden rounded-[9px] border border-transparent bg-white/[.055] transition-[border-color,background-color] hover:bg-white/[.07] focus-within:border-[var(--kodety-focus)]/70 focus-within:bg-white/[.07]"
              >
                <span className="grid w-9 shrink-0 place-items-center border-r border-white/[.055] bg-black/[.07] text-white/32 transition-colors group-focus-within/share-invite:text-[var(--kodety-accent-hover)]">
                  <Mail className="size-3.5" />
                </span>
                <Input
                  data-kodety-share-control-inner
                  type="email"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  onKeyDown={event => {
                    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    void invite();
                  }}
                  placeholder="nome@email.com"
                  inputMode="email"
                  autoComplete="email"
                  spellCheck={false}
                  disabled={saving}
                  className="block !m-0 !h-auto !min-h-0 min-w-0 flex-1 self-stretch !rounded-none !border-0 !bg-transparent px-2.5 !py-0 text-[12px] !shadow-none !outline-none placeholder:text-white/30 focus-visible:!border-0 focus-visible:!shadow-none focus-visible:!outline-none focus-visible:!ring-0"
                  autoFocus
                />
                <span className="grid h-full w-9 shrink-0 place-items-center border-l border-white/[.055] bg-black/[.08]">
                  <ShareActionTooltip label="Enviar convite">
                    <button
                      type="button"
                      className="grid size-7 shrink-0 place-items-center rounded-[7px] border-0 bg-[var(--kodety-accent)] p-0 text-[var(--kodety-accent-foreground)] outline-none transition-colors hover:bg-[var(--kodety-accent-hover)] focus-visible:bg-[var(--kodety-accent-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                      disabled={saving}
                      onClick={() => void invite()}
                      aria-label="Enviar convite"
                    >
                      {saving ? <Loader2 className="size-[13px] animate-spin" /> : <ArrowUp className="size-[13px] stroke-[1.7]" />}
                    </button>
                  </ShareActionTooltip>
                </span>
              </div>
              <Select value={invitePermission} onValueChange={value => setInvitePermission(value as 'view' | 'edit')}>
                <SelectTrigger className="mt-2 h-8 w-full min-w-0 gap-0 overflow-hidden rounded-[8px] border-transparent bg-white/[.05] !p-0 !pr-2.5 text-[11px] hover:bg-white/[.065] focus-visible:border-[var(--kodety-focus)]/70 focus-visible:bg-white/[.065] focus-visible:ring-0 data-[state=open]:border-[var(--kodety-focus)]/70 data-[state=open]:bg-white/[.065]">
                  <span className="mr-2 grid h-full w-8 shrink-0 place-items-center border-r border-white/[.055] bg-black/[.06] text-white/35">
                    <Lock className="size-3.5" />
                  </span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start" className={SHARE_SELECT_CONTENT_CLASS}>
                  <SelectItem value="edit">Acesso completo · pode editar</SelectItem>
                  <SelectItem value="view">Somente visualização</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <section data-kodety-share-access className="mt-3 overflow-hidden rounded-[12px] border border-white/[.07] bg-white/[.025]">
              <div className="flex min-h-[58px] items-center gap-2.5 px-3 py-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-[8px] border border-white/[.07] bg-white/[.055] text-emerald-300"><Users className="size-3.5" /></span>
                <div className="min-w-0 flex-1">
                  <p data-kodety-no-i18n className="truncate text-[12px] font-medium text-[var(--kodety-text)]">{projectName}</p>
                  <p className="mt-0.5 truncate text-[10px] text-[var(--kodety-info-copy)]">
                    {englishUi
                      ? 'Exclusive editing · one active editor at a time'
                      : 'Edição exclusiva · uma pessoa por vez'}
                  </p>
                </div>
                <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-white/[.045] px-2 py-1 text-[9px] text-[var(--kodety-info-copy)] sm:inline-flex">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  {englishUi ? 'Protected' : 'Protegido'}
                </span>
              </div>

              <div className="flex min-h-[64px] flex-wrap items-center gap-x-2.5 gap-y-2 border-t border-white/[.07] px-3 py-2.5 sm:flex-nowrap">
                <span className="grid size-8 shrink-0 place-items-center rounded-[8px] border border-white/[.07] bg-white/[.055] text-[var(--kodety-accent-hover)]"><Link2 className="size-3.5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-[var(--kodety-text)]">Link do projeto</p>
                  <p className="mt-0.5 truncate text-[10px] text-[var(--kodety-info-copy)]">
                    {share.enabled
                      ? (englishUi ? 'Share access with a controlled permission.' : 'Compartilhe o acesso com uma permissão controlada.')
                      : (englishUi ? 'No public project link is active.' : 'Nenhum link público está ativo.')}
                  </p>
                </div>
                <div className="ml-10 flex min-w-0 basis-[calc(100%-2.5rem)] items-center gap-1.5 sm:ml-0 sm:basis-auto">
                  <Select
                    value={share.enabled ? share.permission : 'disabled'}
                    onValueChange={(value) => {
                      if (value === 'disabled') {
                        const next = { ...share, enabled: false };
                        setShare(next);
                        void save(next);
                        return;
                      }
                      const permission = value as 'view' | 'edit';
                      const next = { ...share, enabled: true, permission, authRequired: permission === 'edit' };
                      setShare(next);
                      void save(next);
                    }}
                  >
                    <SelectTrigger className="h-8 min-w-0 flex-1 gap-1 rounded-[8px] border-transparent bg-white/[.05] !px-2.5 text-[10px] text-[var(--kodety-text-secondary)] shadow-none hover:bg-white/[.065] focus-visible:border-[var(--kodety-focus)]/70 focus-visible:bg-white/[.065] focus-visible:ring-0 data-[state=open]:border-[var(--kodety-focus)]/70 data-[state=open]:bg-white/[.065] sm:w-[142px] sm:flex-none [&>svg]:size-3"><SelectValue /></SelectTrigger>
                    <SelectContent align="end" className={SHARE_SELECT_CONTENT_CLASS}>
                      <SelectItem value="view">Qualquer pessoa pode visualizar</SelectItem>
                      <SelectItem value="edit">Contas autenticadas podem editar</SelectItem>
                      <SelectItem value="disabled">Link desativado</SelectItem>
                    </SelectContent>
                  </Select>
                  {saving && <Loader2 className="size-3 shrink-0 animate-spin text-[var(--kodety-text-tertiary)]" />}
                  {share.enabled && share.url ? (
                    <Button type="button" size="sm" variant="secondary" className="h-8 shrink-0 rounded-[8px] border border-transparent bg-white/[.07] px-2.5 text-[10px] shadow-none hover:bg-white/[.11] focus-visible:border-[var(--kodety-focus)]/70 focus-visible:ring-0" onClick={() => void copyUrl()}><Copy className="size-3" /> Copiar</Button>
                  ) : (
                    <Button type="button" size="sm" className="h-8 shrink-0 rounded-[8px] border border-transparent bg-[var(--kodety-accent)] px-2.5 text-[10px] text-white shadow-none hover:bg-[var(--kodety-accent-hover)] focus-visible:border-[var(--kodety-focus)] focus-visible:ring-0" disabled={saving} onClick={() => void save({ ...share, enabled: true, permission: 'view' })}>Ativar</Button>
                  )}
                </div>
              </div>

              {share.invitations.map(invitation => (
                <div key={invitation.email} className="flex min-h-[62px] items-center gap-3 px-3.5 py-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-white/[0.06] text-[10px] font-semibold text-zinc-300">{initials(invitation.email)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-zinc-200">{invitation.email}</p>
                    <p className="mt-0.5 text-[10px] text-[var(--kodety-info-copy)]">
                      {invitation.accepted
                        ? (englishUi ? 'Access accepted' : 'Acesso aceito')
                        : (englishUi ? 'Pending invite' : 'Convite pendente')}
                      {' · '}
                      {invitation.permission === 'edit'
                        ? (englishUi ? 'can edit' : 'pode editar')
                        : (englishUi ? 'can view' : 'pode visualizar')}
                    </p>
                  </div>
                  <ShareActionTooltip label={`Remover convite de ${invitation.email}`}>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      className="size-7 rounded-[7px] text-[var(--kodety-text-tertiary)] hover:bg-[var(--kodety-danger)]/10 hover:text-[var(--kodety-danger)] focus-visible:text-[var(--kodety-danger)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-danger)]/60"
                      disabled={saving}
                      onClick={() => void removeInvitation(invitation.email)}
                      aria-label={`Remover convite de ${invitation.email}`}
                    >
                      <Trash2 />
                    </Button>
                  </ShareActionTooltip>
                </div>
              ))}
            </section>

            {share.enabled && share.url && (
              <div className="mt-3 flex items-center justify-between gap-3 px-1 text-[10px] text-[var(--kodety-info-copy)]">
                <span className="inline-flex items-center gap-1.5"><Check className="size-3 text-emerald-400" /> Convites e link presos a este projeto</span>
                <Button type="button" size="xs" variant="ghost" disabled={saving} onClick={() => void save(share, true)}><RefreshCw /> Gerar outro link</Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
