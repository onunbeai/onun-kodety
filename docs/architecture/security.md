# Segurança e isolamento

O preview executa cada documento em iframe com `sandbox="allow-scripts"`, origem opaca e CSP restritiva. O editor não é exposto ao componente. Mensagens carregam versão do protocolo, ID de sessão, token imprevisível, sequência, limite de tamanho e rate limit. Módulos Node e imports fora da allowlist são rejeitados antes da compilação. Bundles possuem limite de bytes; compilações anteriores são canceladas; Blob URLs são revogadas no descarte.

Não é usado `eval`, `new Function` ou injeção de script clássico. O sandbox carrega ESM por `import()` de URL validada. Erros de render são isolados por instância e logs possuem limite.

## Limitações do navegador

Um iframe não é um limite de CPU: um loop síncrono infinito ainda pode bloquear a thread principal. Limites rígidos de tempo, memória, análise de malware, resolução segura de pacotes e bundles reproduzíveis exigem compilação em worker dedicado ou serviço isolado no servidor. Código publicado deixa o sandbox do editor e passa a ter as permissões do site; por isso a publicação deve aceitar somente bundles produzidos pelo pipeline confiável, armazenar hash e aplicar CSP do domínio.

Cookies do editor não ficam disponíveis no iframe de origem opaca. Requests de rede permanecem limitados pela CSP e devem usar uma allowlist por projeto. O runtime publicado deve receber apenas tokens de API com escopo público; segredos e funções privilegiadas pertencem ao servidor.
