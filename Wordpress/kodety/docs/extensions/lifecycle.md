# Lifecycle

## Estados

```text
ZIP validado -> instalado/inativo -> ativo -> inativo -> removido
                                    \-> atualização/migração pendente
```

Instalação valida e move os arquivos de forma atômica, mas não executa o
entrypoint. Ativação carrega o entrypoint, registra integrações e dispara os
hooks de ativação. Desativação deixa de carregar o PHP em requests futuros.
Remoção apaga somente a pasta da extensão; o usuário pode escolher preservar
ou excluir settings gerenciadas pelo instalador. Dados da Public Storage devem
ter política de remoção documentada pela própria extensão.

## Hooks públicos

```php
$extension = kodety_extension();
if (!$extension || $extension->slug() !== 'vendor-feature') return;

add_action(
    'kodety_extension_activate_vendor-feature',
    static function () use ($extension): void {
        $storage = $extension->storage();
        if (!$storage->has('schema')) $storage->set('schema', 1);
    }
);

add_action(
    'kodety_extension_deactivate_vendor-feature',
    static function (): void {
        // Cancele cron/jobs temporários. Preserve conteúdo do usuário.
    }
);
```

Os callbacks dinâmicos recebem, se o registro aceitar argumentos, o manifesto
normalizado e o manager legado. Código novo deve capturar o contexto público e
não usar o manager.

Eventos globais de observação disponíveis:

- `kodety_extension_before_activate`;
- `kodety_extension_after_activate`;
- `kodety_extension_deactivate_{slug}`;
- `kodety_extension_after_deactivate`;
- `kodety_extension_loaded`;
- `kodety_extensions_loaded`;
- `kodety_extension_before_uninstall`;
- `kodety_extension_after_uninstall`.

Prefira o hook específico do slug para mutações próprias. Não altere o estado
de outra extensão em observadores globais.

## Atualização

Ao instalar uma nova versão sobre uma extensão ativa, o registry marca
`pendingActivation`. No request seguinte o novo entrypoint é carregado e o hook
de ativação do slug roda novamente. Portanto:

- migrations precisam ser idempotentes;
- armazene um número de schema próprio;
- migre em passos pequenos e ascendentes;
- só grave o novo schema após cada passo bem-sucedido;
- não dependa de uma chamada única do hook;
- não faça downgrade destrutivo automaticamente.

Se entrypoint ou migration lançarem uma exceção, o Onun Kodety desativa a extensão,
preserva o erro no registry e impede que dependentes carreguem.

## Desativação e remoção

Desativar deve ser reversível. Não apague projetos, mídia ou dados do usuário.
Remoção definitiva deve ser opt-in, claramente descrita e limitada ao namespace
da extensão. Nunca remova options, tabelas ou diretórios por prefixos amplos.

