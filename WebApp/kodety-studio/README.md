# Onun Kodety — editor web

Editor HTML local e independente, distribuído sob GPL-3.0. Não exige conta,
assinatura, licença paga nem acesso aos serviços privados do Kodety.

Na raiz do repositório, instale as dependências e execute o comando de desenvolvimento
documentado no README principal. Abra a URL local e crie um projeto no navegador
(OPFS) ou em uma pasta do computador (navegadores com File System Access).
Exporte backups ZIP regularmente: dados locais podem ser apagados pelo navegador.

O editor mantém publicação HTML, ZIP editável, exportação para WordPress,
integrações com serviços de hospedagem usando suas próprias credenciais e Agent
com provedor configurado pelo usuário. A conexão MCP usa tokens por projeto;
as integrações externas continuam exigindo autorização do respectivo provedor.

O build inclui o arquivo WordPress produzido pelo build principal. Para hospedagem
própria, sirva a pasta `dist` por HTTPS usando `node dist/server.mjs`.
O servidor local implementa as pontes MCP e autenticação das integrações de publicação.
GitHub OAuth opcional usa `KODETY_GITHUB_CLIENT_ID`; tokens pessoais também podem
ser usados pela interface. Não há servidor central obrigatório.

Nomes internos `kodety`, rotas e identificadores de dados são preservados para
compatibilidade com projetos e extensões existentes.
