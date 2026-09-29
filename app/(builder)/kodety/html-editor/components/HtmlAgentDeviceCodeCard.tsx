'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Check, Copy, ExternalLink, Loader2 } from '@/components/ui/gravity-icons';
import { agentAccountLoginUrl } from '@/lib/html-editor/agent-account-popup';
import { cn } from '@/lib/utils';

interface HtmlAgentDeviceCodeCardProps {
  userCode: string;
  onContinue: () => void;
  onCancel?: () => void;
  disabled?: boolean;
  opened?: boolean;
  popupBlocked?: boolean;
  verificationUrl: string;
}

type CopyStatus = 'idle' | 'copying' | 'copied' | 'error';

export function HtmlAgentDeviceCodeCard({
  userCode,
  onContinue,
  onCancel,
  disabled = false,
  opened = false,
  popupBlocked = false,
  verificationUrl,
}: HtmlAgentDeviceCodeCardProps) {
  const id = useId();
  const copyRequestRef = useRef(0);
  const [copyState, setCopyState] = useState<{ code: string; status: CopyStatus } | null>(null);
  const copyStatus = copyState?.code === userCode ? copyState.status : 'idle';
  const fallbackUrl = agentAccountLoginUrl(verificationUrl);

  useEffect(() => {
    setCopyState(null);
    return () => { copyRequestRef.current += 1; };
  }, [userCode]);

  async function copyCode() {
    if (disabled || !userCode || copyStatus === 'copying') return;
    const request = ++copyRequestRef.current;
    setCopyState({ code: userCode, status: 'copying' });
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(userCode);
      if (request === copyRequestRef.current) setCopyState({ code: userCode, status: 'copied' });
    } catch {
      if (request === copyRequestRef.current) setCopyState({ code: userCode, status: 'error' });
    }
  }

  return (
    <section
      data-kodety-settings-card
      data-agent-device-code-card
      aria-labelledby={`${id}-title`}
      className="@container mt-4 max-w-xl space-y-5 p-5"
    >
      <div>
        <h4 id={`${id}-title`} className="text-sm font-medium text-foreground">Conectar conta OpenAI</h4>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Confirme seu acesso na página oficial da OpenAI para conectar sua conta ao Agent.
        </p>
      </div>

      <div>
        <label htmlFor={`${id}-code`} className="flex items-center gap-2.5 text-xs font-medium text-foreground">
          <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-white/[.06] text-[11px] text-muted-foreground">1</span>
          Copie seu código de acesso
        </label>
        <div className="mt-3 flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
          <input
            id={`${id}-code`}
            aria-describedby={`${id}-copy-feedback`}
            type="text"
            readOnly
            value={userCode}
            spellCheck={false}
            autoComplete="off"
            className="h-11 min-w-0 flex-1 select-all rounded-md border-0 bg-transparent px-1 font-mono! text-base! font-medium! tracking-[.12em] text-foreground outline-none selection:bg-[var(--kodety-accent)]/35 focus-visible:ring-2 focus-visible:ring-ring/60 @[28rem]:text-2xl!"
          />
          <Button
            type="button"
            variant="secondary"
            size="default"
            className={cn('h-10 min-w-[104px] rounded-lg', copyStatus === 'copied' && 'text-emerald-300')}
            disabled={disabled || !userCode || copyStatus === 'copying'}
            onClick={() => void copyCode()}
          >
            {copyStatus === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copyStatus === 'copied' ? 'Copiado' : copyStatus === 'copying' ? 'Copiando…' : 'Copiar'}
          </Button>
        </div>
        <p
          id={`${id}-copy-feedback`}
          role={copyStatus === 'error' ? 'alert' : 'status'}
          aria-live={copyStatus === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
          className={cn('mt-2 text-xs leading-5', copyStatus === 'error' ? 'text-amber-300' : 'text-muted-foreground')}
        >
          {copyStatus === 'error'
            ? 'Não foi possível copiar. Selecione o código acima e copie manualmente.'
            : copyStatus === 'copied'
              ? 'Código copiado. Agora continue na OpenAI.'
              : 'Você também pode selecionar o código e copiá-lo manualmente.'}
        </p>
      </div>

      <div className="border-t border-white/[.07] pt-4">
        <p className="flex items-center gap-2.5 text-xs font-medium text-foreground">
          <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-white/[.06] text-[11px] text-muted-foreground">2</span>
          Continue na OpenAI
        </p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Na página que abrir, entre na sua conta e informe o código. Depois, volte ao Kodety.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" size="default" className="h-10 rounded-lg" disabled={disabled || !userCode} onClick={onContinue}>
            Continuar na OpenAI <ExternalLink aria-hidden="true" />
          </Button>
          {onCancel && (
            <Button type="button" variant="ghost" size="default" className="h-10 rounded-lg" disabled={disabled} onClick={onCancel}>
              Cancelar
            </Button>
          )}
        </div>
      </div>

      {popupBlocked ? (
        <div role="status" aria-live="polite" className="rounded-lg border border-amber-300/15 bg-amber-300/[.04] px-3 py-2.5 text-xs leading-5">
          <p className="text-amber-200">A janela da OpenAI não abriu. Tente continuar novamente.</p>
          {fallbackUrl && !disabled && (
            <a
              href={fallbackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1.5 rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              Abrir página oficial da OpenAI <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          )}
        </div>
      ) : opened ? (
        <div role="status" aria-live="polite" className="flex items-start gap-2.5 rounded-lg bg-white/[.035] px-3 py-2.5 text-xs leading-5 text-muted-foreground">
          <Loader2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" />
          <p>Aguardando a confirmação na OpenAI. A conexão será atualizada aqui quando você concluir.</p>
        </div>
      ) : null}
    </section>
  );
}
