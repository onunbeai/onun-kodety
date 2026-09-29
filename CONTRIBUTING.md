# Contribuindo com Onun Kodety

O Onun Kodety é um editor visual para HTML e WordPress. Contribuições ao código próprio seguem a GPL-3.0-only; preserve as licenças e atribuições dos componentes de terceiros.

## Ambiente

Use Node.js 22.12+ (ou 24/26), npm e PHP 8.0+. Execute `npm ci` na raiz.

- `npm run dev`: editor HTML local.
- `npm run check`: TypeScript e sintaxe PHP.
- `npm run verify`: tipos, PHP, regressões open source, Motion e builds.
- `npm test`: suíte ampliada herdada do editor.
- `npm run wordpress:zip:plugin`: plugin instalável.
- `npm run build`: plugin WordPress e aplicação web.

## Alterações

Abra uma issue descrevendo problemas maiores e inclua passos de reprodução. Em pull requests, descreva a alteração e os testes executados. Mantenha compatibilidade com projetos existentes. Não adicione arquivos compilados, dados de clientes, credenciais ou pacotes ZIP ao Git.

Rotas e identificadores internos `kodety`, `KODETY_*` e `@coday/*` permanecem por compatibilidade; o nome público é Onun Kodety. Não reintroduza ativação comercial ou serviços privados obrigatórios. A autenticação do WordPress e das integrações configuradas pelo usuário continua obrigatória.
