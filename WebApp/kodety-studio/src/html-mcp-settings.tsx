import { useEffect, useState, useSyncExternalStore } from 'react';
import { HtmlMcpSettingsContent } from '../../../app/(builder)/kodety/html-editor/components/HtmlMcpSettingsContent';
import { getAdminUiLocale } from '../../../lib/admin-ui-locale';
import type { HtmlMcpController } from './html-mcp-controller';

/** The host supplies persistence/transport; the integration UI is shared with WordPress. */
export function HtmlWorkspaceMcpSettings({ controller }: { controller: HtmlMcpController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [remoteConfig, setRemoteConfig] = useState('');
  const [revoking, setRevoking] = useState<string | null>(null);
  const english = getAdminUiLocale().toLowerCase().startsWith('en');
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : (english ? 'MCP operation failed.' : 'A operação MCP falhou.')); }
    finally { setBusy(false); }
  };
  const create = async () => {
    const config = await controller.createConnection();
    setRemoteConfig(config);
    try { await navigator.clipboard.writeText(config); }
    catch { setError(english ? 'The connection was created. Copy the configuration shown below.' : 'A conexão foi criada. Copie a configuração exibida abaixo.'); }
  };
  useEffect(() => { let live = true; void controller.refresh().catch(cause => { if (live) setError(cause instanceof Error ? cause.message : 'MCP unavailable.'); }); return () => { live = false; }; }, [controller]);
  return <>
    <p className="mb-4 text-xs leading-5 text-muted-foreground">{english
      ? 'Connect an external assistant to this HTML project. The Studio server relays requests to this browser; static-only hosting needs the Studio Node server. The connection works while this project stays open.'
      : 'Conecte um assistente externo a este projeto HTML. O servidor do Studio encaminha as chamadas para este navegador; uma hospedagem apenas estática precisa do servidor Node do Studio. A conexão funciona enquanto este projeto permanecer aberto.'}</p>
    {(error || state.error) && <p role="alert" className="mb-4 text-xs leading-5 text-amber-300">{error || state.error}</p>}
    <HtmlMcpSettingsContent
      host={{ mode: 'html', origin: new URL(state.status.siteUrl || document.baseURI).origin }}
      wordpress={{ canManageIntegrations: true }}
      status={state.status} loading={busy || state.loading} command="" remoteConfig={remoteConfig}
      projectConnections={state.connections} projectConnectionsLoading={state.loading}
      projectConnectionsError="" revokingProjectConnectionId={revoking}
      onRefresh={() => run(() => controller.refresh())}
      onRefreshProjectConnections={() => run(() => controller.refresh())}
      onCreateProjectConnection={() => run(create)}
      onRevokeProjectConnection={id => run(async () => { setRevoking(id); try { await controller.revokeConnection(id); setRemoteConfig(''); } finally { setRevoking(null); } })}
      onCopySkillInstallPrompt={() => undefined}
      onChangeConnection={operation => run(async () => { setRemoteConfig(''); const config = await controller.changeConnection(operation); if (config) setRemoteConfig(config); })}
    />
  </>;
}
