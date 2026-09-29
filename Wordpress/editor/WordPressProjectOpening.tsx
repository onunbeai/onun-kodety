import { Button } from '@/components/ui/button';
import { KodetyLoadingScreen } from '@/components/ui/kodety-loading-screen';

/** The WordPress entry never falls through to the standalone file launcher. */
export function WordPressProjectOpening({ loading, dashboardUrl, onRetry }: {
  loading: boolean;
  dashboardUrl: string;
  onRetry: () => void;
}) {
  return <main data-kodety-project-opening className="dark grid h-screen place-items-center overflow-hidden bg-[#111212] text-foreground">
    {loading ? <KodetyLoadingScreen label="Carregando editor" /> : (
      <section role="alert" className="max-w-sm px-6 text-center">
        <h1 className="text-base font-medium">Não foi possível abrir o projeto</h1>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">Tente conectar novamente ao WordPress ou volte ao painel para conferir o projeto.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button size="sm" onClick={onRetry}>Tentar novamente</Button>
          <Button size="sm" variant="secondary" asChild><a href={dashboardUrl}>Voltar ao painel</a></Button>
        </div>
      </section>
    )}
  </main>;
}
