'use client';

import { AlertTriangle, ArrowRight, Cable, Download, Loader2 } from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AgentRuntimeDiagnostic, AgentRuntimeProgress } from '@/lib/html-editor/agent-runtime-setup';

const HOST_NETWORK_BLOCK_CODES = new Set([
  'runtime_download_dns',
  'runtime_download_timeout',
  'runtime_download_failed',
  'runtime_download_tls',
  'runtime_download_blocked',
]);

const HOST_RESOURCE_BLOCK_CODES = new Set([
  'runtime_storage_unavailable',
  'runtime_lock_unavailable',
  'runtime_install_failed',
  'node_resources',
  'codex_resources',
  'node_probe_timeout',
  'codex_probe_timeout',
]);

const HOST_EXECUTION_BLOCK_CODES = new Set([
  'browser_runtime_unsupported',
  'exec_unavailable',
  'autostart_unsupported',
  'runtime_platform_unsupported',
  'runtime_noexec',
  'node_execution_denied',
  'codex_execution_denied',
  'node_invalid',
  'codex_invalid',
  'codex_exec_failed',
  'node_system_incompatible',
  'codex_system_incompatible',
  'node_architecture',
  'codex_architecture',
  'sidecar_start_stalled',
  'codex_start_stalled',
  'sidecar_start_failed',
  'sidecar_start_timeout',
  'sidecar_unavailable',
  'codex_start_failed',
  'codex_start_timeout',
]);

const HOST_BLOCK_CODES = new Set([
  ...HOST_NETWORK_BLOCK_CODES,
  ...HOST_RESOURCE_BLOCK_CODES,
  ...HOST_EXECUTION_BLOCK_CODES,
]);

export function isAgentRuntimeHostBlocked(diagnostic: AgentRuntimeDiagnostic | null) {
  return Boolean(diagnostic && HOST_BLOCK_CODES.has(diagnostic.code));
}

function megabytes(bytes: number) {
  return (bytes / 1_048_576).toLocaleString('pt-BR', {
    maximumFractionDigits: 1,
  });
}

function RuntimeProgress({ progress, active }: { progress: AgentRuntimeProgress | null; active: boolean }) {
  const percent = progress?.totalBytes
    ? Math.min(100, Math.floor((progress.downloadedBytes / progress.totalBytes) * 100))
    : null;
  const downloading = progress?.phase.startsWith('download_') === true;
  const starting = progress?.phase.startsWith('start_') === true;

  return (
    <div data-agent-runtime-state="preparing" role="status" aria-live="polite" className="min-w-0 text-left">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-white/[.045] text-white/40">
          {downloading ? (
            <Download className="size-3.5" />
          ) : (
            <Loader2 className={cn('size-3.5', active && 'animate-spin motion-reduce:animate-none')} />
          )}
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-medium text-foreground/90">
              {downloading ? 'Baixando componentes' : starting ? 'Iniciando o Agent' : 'Preparando o Agent'}
            </p>
            {progress && (
              <span className="shrink-0 text-[9px] tabular-nums text-[var(--kodety-text-tertiary)]">
                {progress.step}/{progress.stepCount}
              </span>
            )}
          </div>
          <p className="mt-0.5 break-words text-[9px] leading-4 text-muted-foreground">
            {progress?.message || 'Verificando os componentes necessários…'}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <div
          role="progressbar"
          aria-label="Preparação dos componentes do Agent"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
          className="h-1 overflow-hidden rounded-full bg-white/[.07]"
        >
          <span
            className={cn(
              'block h-full rounded-full bg-[var(--kodety-accent-hover)] transition-[width] duration-300 motion-reduce:transition-none',
              percent === null && 'w-1/3 animate-pulse motion-reduce:animate-none',
            )}
            style={percent === null ? undefined : { width: `${percent}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-[9px] tabular-nums text-[var(--kodety-text-tertiary)]">
          <span>
            {percent !== null && progress?.totalBytes
              ? `${megabytes(progress.downloadedBytes)} de ${megabytes(progress.totalBytes)} MiB`
              : progress
                ? `Etapa ${progress.step} de ${progress.stepCount}`
                : 'Aguarde um instante'}
          </span>
          <span className="text-right">
            {downloading ? 'Em partes · retomada automática' : starting ? 'Validando o serviço' : 'Progresso salvo'}
          </span>
        </div>
      </div>
    </div>
  );
}

export function HtmlAgentRuntimeStatus({
  progress,
  diagnostic,
  active = false,
  browserStudio = false,
  transport = 'local',
  onUseMcp,
  onUseCloud,
  onUseBrowser,
  onConfigure,
  cloudBusy = false,
  className,
}: {
  progress: AgentRuntimeProgress | null;
  diagnostic: AgentRuntimeDiagnostic | null;
  active?: boolean;
  browserStudio?: boolean;
  transport?: 'local' | 'remote' | 'webcontainer';
  onUseMcp?: () => void;
  onUseCloud?: () => void;
  onUseBrowser?: () => void;
  onConfigure?: () => void;
  cloudBusy?: boolean;
  className?: string;
}) {
  if (!progress && !diagnostic && !active) return null;

  const hostingBlocked = transport === 'local' && isAgentRuntimeHostBlocked(diagnostic);
  if (diagnostic && !active && hostingBlocked) {
    const networkBlocked = HOST_NETWORK_BLOCK_CODES.has(diagnostic.code);
    const resourceBlocked = HOST_RESOURCE_BLOCK_CODES.has(diagnostic.code);
    const inBrowser = browserStudio || diagnostic.code === 'browser_runtime_unsupported';
    const blockTitle = networkBlocked
      ? 'A hospedagem não permite preparar o Agent'
      : resourceBlocked
        ? 'A hospedagem não oferece os recursos necessários'
        : 'O Agent não iniciou no servidor';
    const blockDescription = onUseBrowser
      ? 'Esta hospedagem não oferece os recursos necessários para executar o Agent no servidor. A opção No navegador executa o Agent na aba do Builder.'
      : networkBlocked
      ? 'Hospedagens compartilhadas podem bloquear DNS, HTTPS ou downloads em partes. Sem esse acesso, os componentes necessários não podem ser instalados neste servidor.'
      : resourceBlocked
        ? 'Hospedagens compartilhadas podem limitar armazenamento, memória, processos ou permissões essenciais para o Agent funcionar neste servidor.'
        : 'A execução No servidor depende dos recursos da hospedagem. Se ela não permitir, selecione No navegador nas configurações do Agent.';
    return (
      <div
        data-agent-runtime-state="hosting-blocked"
        role="alert"
        className={cn('min-w-0 border-y border-white/[.065] py-4 text-left', className)}
      >
        <div className="flex items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-amber-400/[.07] text-amber-300/75">
            <AlertTriangle className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-[10px] font-medium leading-4 text-foreground/90">
              {blockTitle}
            </p>
            <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
              {blockDescription}
            </p>
            <p className="mt-2 text-[9px] leading-4 text-muted-foreground">
              <span className="font-medium text-foreground/75">Motivo detectado:</span> {diagnostic.message}
            </p>
            <p className="mt-1 text-[8px] text-[var(--kodety-text-tertiary)]">
              Diagnóstico <code className="break-all">{diagnostic.code}</code>
            </p>
          </div>
        </div>

        <div className="mt-3 border-t border-white/[.055] pt-3">
          {onUseBrowser && (
            <div className="mb-3">
              <p className="text-[9px] leading-4 text-muted-foreground">
                Salve o projeto e conecte sua conta OpenAI nesse ambiente. Mantenha o Builder aberto enquanto o Agent trabalha.
              </p>
              <Button type="button" size="sm" className="mt-3 w-full" disabled={cloudBusy} onClick={onUseBrowser}>
                {cloudBusy ? <Loader2 className="animate-spin" /> : <Cable />}
                {cloudBusy ? 'Preparando…' : 'Usar no navegador'} <ArrowRight className="ml-auto" />
              </Button>
            </div>
          )}
          {onUseMcp ? (
            <>
              <p className="text-[9px] leading-4 text-muted-foreground">
                {inBrowser
                  ? 'Conecte seu cliente pela ponte MCP do Studio e mantenha este projeto aberto durante o trabalho.'
                  : 'Conecte um cliente de IA compatível ao WordPress via MCP. O cliente executa o agente, sem precisar iniciar o App Server nesta hospedagem.'}
              </p>
              <Button type="button" size="sm" variant={onUseCloud || onUseBrowser ? 'ghost' : 'default'} className="mt-3 w-full" onClick={onUseMcp}>
                <Cable /> Conectar via MCP <ArrowRight className="ml-auto" />
              </Button>
            </>
          ) : (
            <p className="text-[9px] leading-4 text-muted-foreground">{diagnostic.action}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div data-agent-runtime-state={transport === 'webcontainer' && diagnostic && !active ? 'browser-error' : undefined}
      className={cn('min-w-0 rounded-[9px] border border-white/[.065] bg-white/[.025] p-3.5 text-left', className)}>
      {diagnostic && !active && (
        <div role="alert" className="flex min-w-0 items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-amber-400/[.07] text-amber-300/75">
            <AlertTriangle className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="break-words text-[10px] font-medium leading-4 text-foreground/90">{diagnostic.message}</p>
            {diagnostic.action && (
              <p className="mt-1 break-words text-[9px] leading-4 text-muted-foreground">{diagnostic.action}</p>
            )}
            {onConfigure && (diagnostic.code.startsWith('agent_remote_') || /license|entitled|nonce|forbidden/.test(diagnostic.code)) && (
              <Button type="button" size="sm" variant="outline" className="mt-3 w-full" onClick={onConfigure}>
                Configurar acesso ao Kodety <ArrowRight className="ml-auto" />
              </Button>
            )}
            <p className="mt-1.5 text-[8px] text-[var(--kodety-text-tertiary)]">
              Código <code className="break-all">{diagnostic.code}</code>
            </p>
          </div>
        </div>
      )}
      {(active || (!diagnostic && progress)) && (
        <div className={cn(diagnostic && !active && 'mt-3 border-t border-white/[.055] pt-3')}>
          <RuntimeProgress progress={progress} active={active} />
        </div>
      )}
    </div>
  );
}
