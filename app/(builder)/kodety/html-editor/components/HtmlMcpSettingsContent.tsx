'use client';

import {
  Braces,
  Code2,
  Copy,
  Download,
  Link2,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
} from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export interface McpStatusState {
  enabled: boolean;
  browserStudio?: boolean;
  configured?: boolean;
  revision?: number;
  workspaceRevision?: number;
  siteUrl?: string;
  remoteUrl?: string;
  remoteConfig?: string;
  command?: string;
  skills?: {
    version: string;
    distributionScope: 'external-mcp-clients';
    nativeAgent: {
      managedBy: 'kodety-builder';
      installRequired: false;
      updateCheckRequired: false;
    };
    catalogUri: string;
    bundleUrl: string;
    installPrompt: string;
    packages: Array<{
      name: string;
      title: string;
      description: string;
      digest: string;
      fileCount: number;
      manifestUri: string;
    }>;
  };
}

export interface McpProjectConnectionSummary {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  currentProject: boolean;
}

function formatConnectionCreatedAt(value: string): string {
  const createdAt = new Date(value);
  if (Number.isNaN(createdAt.getTime())) return 'Data de criação indisponível';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(createdAt);
}

export interface HtmlMcpSettingsContentProps {
  host?: { mode: 'html'; origin: string };
  wordpress: {
    canManageIntegrations?: boolean;
    projectConnectionUrl?: string;
    studio?: {
      enabled?: boolean;
      studioOrigin?: string;
    } | null;
  };
  status: McpStatusState | null;
  loading: boolean;
  command: string;
  remoteConfig: string;
  projectConnections: McpProjectConnectionSummary[];
  projectConnectionsLoading: boolean;
  projectConnectionsError: string;
  revokingProjectConnectionId: string | null;
  onRefresh: () => void | Promise<void>;
  onRefreshProjectConnections: () => void | Promise<void>;
  onCreateProjectConnection: () => void | Promise<void>;
  onRevokeProjectConnection: (connectionId: string) => void | Promise<void>;
  onCopySkillInstallPrompt: () => void | Promise<void>;
  onChangeConnection: (operation: 'enable' | 'rotate' | 'disable') => void | Promise<void>;
}

export function HtmlMcpSettingsContent({
  host,
  wordpress,
  status,
  loading,
  command,
  remoteConfig,
  projectConnections,
  projectConnectionsLoading,
  projectConnectionsError,
  revokingProjectConnectionId,
  onRefresh,
  onRefreshProjectConnections,
  onCreateProjectConnection,
  onRevokeProjectConnection,
  onCopySkillInstallPrompt,
  onChangeConnection,
}: HtmlMcpSettingsContentProps) {
  const isBrowserStudio = wordpress.studio?.enabled === true || status?.browserStudio === true;
  const isHtml = host?.mode === 'html';
  return (
    <>
      <div className="flex items-start gap-4 py-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">
              {isBrowserStudio
                ? status?.enabled ? 'MCP do Studio conectado' : 'MCP do Studio desativado'
                : status?.enabled ? 'MCP conectado' : 'MCP desativado'}
            </p>
            <span className={`text-[11px] ${status?.enabled ? 'text-emerald-400' : 'text-muted-foreground'}`}>
              {status?.enabled ? 'Ativo' : 'Inativo'}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {isHtml
              ? 'Conexões autorizadas usam as ferramentas do Builder e salvam na pasta escolhida. Mantenha o projeto aberto no navegador durante o trabalho.'
              : isBrowserStudio
              ? 'O Studio encaminha as chamadas externas para este WordPress local enquanto o projeto permanece aberto no navegador.'
              : status?.enabled
              ? 'Conexões MCP autorizadas podem editar seus projetos e podem ser revogadas a qualquer momento.'
              : 'Nenhum agente externo possui acesso ao projeto.'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Atualizar status do MCP"
          onClick={() => void onRefresh()}
          disabled={loading}
        >
          <RefreshCw className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      {wordpress.canManageIntegrations && (wordpress.projectConnectionUrl || isHtml) && (
        <>
          {isBrowserStudio && (
            <div
              data-kodety-mcp-studio-relay
              className="mt-5 rounded-[10px] border border-[var(--kodety-accent)]/20 bg-[var(--kodety-accent)]/[.045] p-4"
              role="note"
            >
              <p className="text-xs font-semibold">Ponte MCP segura do Studio</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {isHtml
                  ? `O endereço copiado usa ${host.origin} e chega somente a este projeto HTML pela aba aberta. Mantenha esta aba aberta enquanto Codex, Claude ou outro cliente MCP estiver trabalhando.`
                  : 'O endereço copiado chega a este projeto pelo navegador. Mantenha esta aba aberta enquanto Codex, Claude ou outro cliente MCP estiver trabalhando.'}
              </p>
            </div>
          )}
          <div
            data-kodety-mcp-project-connection
            className="mt-5 flex flex-col gap-3 rounded-[10px] border border-[var(--kodety-divider)] bg-white/[.025] p-4 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">
                {isBrowserStudio ? '1. Conecte a IA a este projeto local' : '1. Conecte a IA a este projeto'}
              </p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                Gera uma credencial independente e mostra a configuração uma única vez nesta sessão.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={loading}
              onClick={() => void onCreateProjectConnection()}
            >
              {loading ? <Loader2 className="animate-spin" /> : <Link2 />}
              Copiar conexão deste projeto
            </Button>
          </div>

          <div
            data-kodety-mcp-project-connections
            className="mt-4 overflow-hidden rounded-[10px] border border-[var(--kodety-divider)] bg-white/[.018]"
          >
            <div className="flex items-start gap-3 border-b border-white/[.045] px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold">Conexões por projeto</p>
                  {!projectConnectionsLoading && projectConnections.length > 0 && (
                    <span className="rounded bg-white/[.05] px-1.5 py-0.5 text-[9px] text-muted-foreground">
                      {projectConnections.length} {projectConnections.length === 1 ? 'ativa' : 'ativas'}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  Somente metadados seguros são exibidos. As credenciais nunca podem ser consultadas novamente.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Atualizar conexões MCP"
                disabled={projectConnectionsLoading || revokingProjectConnectionId !== null}
                onClick={() => void onRefreshProjectConnections()}
              >
                <RefreshCw className={projectConnectionsLoading ? 'animate-spin' : ''} />
              </Button>
            </div>

            {projectConnectionsError ? (
              <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
                <p role="alert" className="min-w-0 flex-1 text-[11px] leading-5 text-red-300">
                  {projectConnectionsError}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={projectConnectionsLoading}
                  onClick={() => void onRefreshProjectConnections()}
                >
                  Tentar novamente
                </Button>
              </div>
            ) : projectConnectionsLoading && projectConnections.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-5 text-[11px] text-muted-foreground" role="status">
                <Loader2 className="size-3.5 animate-spin" />
                Consultando conexões autorizadas…
              </div>
            ) : projectConnections.length === 0 ? (
              <p className="px-4 py-5 text-[11px] leading-5 text-muted-foreground">
                Nenhuma conexão individual está ativa.
              </p>
            ) : (
              <div className="divide-y divide-white/[.045]">
                {projectConnections.map(connection => {
                  const connectionLabel = connection.name.trim() || 'Cliente MCP';
                  const projectLabel = connection.projectName.trim() || 'Projeto sem nome';
                  const revoking = revokingProjectConnectionId === connection.id;
                  return (
                    <div
                      key={connection.id}
                      data-kodety-mcp-project-connection-row
                      className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-[11px] font-medium" title={connectionLabel}>
                            {connectionLabel}
                          </p>
                          {connection.currentProject && (
                            <span className="rounded bg-emerald-400/[.09] px-1.5 py-0.5 text-[9px] text-emerald-300">
                              Projeto atual
                            </span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-[10px] text-muted-foreground" title={projectLabel}>
                          {projectLabel}
                        </p>
                        <time
                          dateTime={connection.createdAt || undefined}
                          className="mt-1 block text-[9px] text-muted-foreground/75"
                        >
                          Criada em {formatConnectionCreatedAt(connection.createdAt)}
                        </time>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={loading || projectConnectionsLoading || revokingProjectConnectionId !== null}
                        aria-label={`Revogar conexão ${connectionLabel}`}
                        onClick={() => void onRevokeProjectConnection(connection.id)}
                      >
                        {revoking ? <Loader2 className="animate-spin" /> : <Trash2 />}
                        Revogar
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {status?.skills && (
        <div
          data-kodety-mcp-skill-installer
          className="mt-4 rounded-[10px] border border-[var(--kodety-accent)]/20 bg-[var(--kodety-accent)]/[.045] p-4"
        >
          <div className="flex items-start gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--kodety-accent)]/10 text-[var(--kodety-accent-hover)]">
              <Sparkles className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold">2. Instale as skills oficiais do Kodety</p>
                <span className="rounded bg-white/[.05] px-1.5 py-0.5 text-[9px] text-muted-foreground">
                  Host {status.skills.version}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                Codex e Claude recebem os arquivos desta hospedagem pelo próprio MCP. O manifest compara hashes e
                avisa quando uma cópia externa estiver desatualizada; o Agent nativo do Builder já permanece
                sincronizado.
              </p>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {status.skills.packages.map(skill => (
              <div key={skill.name} className="rounded-[8px] border border-white/[.045] bg-black/[.08] px-3 py-2">
                <p className="text-[11px] font-medium">{skill.title}</p>
                <p className="mt-0.5 text-[9px] text-muted-foreground">
                  {skill.fileCount} arquivos · manifest SHA-256
                </p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-white/[.055] pt-3">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void onCopySkillInstallPrompt()}
            >
              <Copy /> Copiar prompt de instalação
            </Button>
            <Button size="sm" variant="secondary" asChild>
              <a href={status.skills.bundleUrl} download="kodety-agent-skills.zip">
                <Download /> Baixar pacote ZIP
              </a>
            </Button>
          </div>
        </div>
      )}

      <div data-kodety-settings-card className="mt-5 divide-y divide-white/[.045] px-3 text-xs">
        <div className="grid gap-1 py-3 sm:grid-cols-[120px_1fr]">
          <b>Projeto</b>
          <p className="text-muted-foreground">HTML, CSS, JavaScript e assets.</p>
        </div>
        <div className="grid gap-1 py-3 sm:grid-cols-[120px_1fr]">
          <b>Conteúdo</b>
          <p className="text-muted-foreground">{isHtml ? 'Páginas, componentes, animações e idiomas disponíveis no Builder.' : 'CMS, mídia e collections.'}</p>
        </div>
        <div className="grid gap-1 py-3 sm:grid-cols-[120px_1fr]">
          <b>Limites</b>
          <p className="text-muted-foreground">{isHtml ? 'Sem CMS, Analytics, PHP ou publicação externa. A conexão depende da aba e do servidor MCP do Studio.' : 'Sem PHP nem acesso a serviços externos.'}</p>
        </div>
      </div>

      {!isBrowserStudio && command && (
        <div className="mt-5">
          <Label>Execute uma vez no Terminal</Label>
          <div
            data-kodety-settings-control
            className="group/copy-field mt-2 flex min-h-11 items-stretch overflow-hidden rounded-[9px] border border-transparent bg-white/[.04] transition-[border-color,background-color] hover:bg-white/[.055] focus-within:border-[var(--kodety-focus)]/70"
          >
            <span className="grid w-9 shrink-0 place-items-center border-r border-white/[.045] bg-black/[.07] text-white/30 group-focus-within/copy-field:text-[var(--kodety-accent-hover)]">
              <Code2 className="size-3.5" />
            </span>
            <code className="min-w-0 flex-1 break-all px-3 py-2.5 text-xs leading-5 text-emerald-300">
              {command}
            </code>
            <Button
              size="icon-sm"
              variant="ghost"
              className="h-auto w-10 shrink-0 rounded-none border-l border-white/[.045]"
              aria-label="Copiar comando"
              onClick={() => {
                void navigator.clipboard.writeText(command);
                toast.success('Comando copiado');
              }}
            >
              <Copy />
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            A credencial só aparece agora. Gere outra conexão se perder este comando.
          </p>
        </div>
      )}

      {status?.remoteUrl && (
        <div className="mt-5">
          <Label>URL MCP remota</Label>
          <div
            data-kodety-settings-control
            className="group/copy-field mt-2 flex min-h-11 items-stretch overflow-hidden rounded-[9px] border border-transparent bg-white/[.04] transition-[border-color,background-color] hover:bg-white/[.055] focus-within:border-[var(--kodety-focus)]/70"
          >
            <span className="grid w-9 shrink-0 place-items-center border-r border-white/[.045] bg-black/[.07] text-white/30 group-focus-within/copy-field:text-[var(--kodety-accent-hover)]">
              <Link2 className="size-3.5" />
            </span>
            <code className="min-w-0 flex-1 break-all px-3 py-2.5 text-xs leading-5 text-[var(--kodety-accent-hover)]">
              {status.remoteUrl}
            </code>
            <Button
              size="icon-sm"
              variant="ghost"
              className="h-auto w-10 shrink-0 rounded-none border-l border-white/[.045]"
              aria-label="Copiar URL MCP"
              onClick={() => {
                void navigator.clipboard.writeText(status.remoteUrl || '');
                toast.success('URL MCP copiada');
              }}
            >
              <Copy />
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Use esta URL em clientes compatíveis com MCP remoto. A autenticação usa a credencial gerada abaixo.
          </p>
        </div>
      )}

      {remoteConfig && (
        <div className="mt-5">
          <Label>Configuração universal</Label>
          <div
            data-kodety-settings-control
            className="group/copy-field mt-2 flex min-h-11 items-stretch overflow-hidden rounded-[9px] border border-transparent bg-white/[.04] transition-[border-color,background-color] hover:bg-white/[.055] focus-within:border-[var(--kodety-focus)]/70"
          >
            <span className="grid w-9 shrink-0 place-items-center border-r border-white/[.045] bg-black/[.07] text-white/30 group-focus-within/copy-field:text-[var(--kodety-accent-hover)]">
              <Braces className="size-3.5" />
            </span>
            <code className="min-w-0 flex-1 whitespace-pre-wrap break-all px-3 py-2.5 text-xs leading-5 text-emerald-300">
              {remoteConfig}
            </code>
            <Button
              size="icon-sm"
              variant="ghost"
              className="h-auto w-10 shrink-0 rounded-none border-l border-white/[.045]"
              aria-label="Copiar configuração MCP"
              onClick={() => {
                void navigator.clipboard.writeText(remoteConfig);
                toast.success('Configuração MCP copiada');
              }}
            >
              <Copy />
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Esta configuração contém a credencial e só aparece nesta sessão. Cole apenas em uma IA confiável.
          </p>
        </div>
      )}

      {wordpress.canManageIntegrations ? (
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[var(--kodety-divider)] pt-4">
          {status?.enabled ? (
            <>
              <Button variant="secondary" disabled={loading} onClick={() => void onChangeConnection('rotate')}>
                Gerar conexão geral
              </Button>
              <Button variant="destructive" disabled={loading} onClick={() => void onChangeConnection('disable')}>
                Revogar todas
              </Button>
            </>
          ) : (
            <Button disabled={loading} onClick={() => void onChangeConnection('enable')}>
              Ativar MCP
            </Button>
          )}
        </div>
      ) : (
        <p className="mt-5 border-t border-[var(--kodety-divider)] pt-4 text-xs text-muted-foreground">
          Somente administradores podem ativar, renovar ou revogar a conexão MCP.
        </p>
      )}
    </>
  );
}
