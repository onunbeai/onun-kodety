# Onun Kodety

Onun Kodety é um WordPress local que roda dentro do Chrome. A extensão cria projetos isolados, instala e ativa o plugin Kodety e abre o Builder sem exigir PHP, MySQL, Docker, npm ou terminal da pessoa que vai editar o site.

## Experiência de uso

1. Instale a extensão no Chrome.
2. Clique no ícone do Onun Kodety.
3. Crie um projeto e aguarde a primeira inicialização; o primeiro acesso abre o painel do WordPress.
4. Quando quiser editar o site, abra o Builder pela navegação do Studio.
5. Exporte o projeto pelo próprio Kodety ou baixe um backup antes de limpar os dados do navegador.

Cada projeto possui seu próprio WordPress, banco SQLite, uploads, temas e plugins. Alternar de projeto não reaproveita a instalação WordPress de outro projeto.

## Instalação do pacote de desenvolvimento

Para gerar a entrega:

```bash
npm run studio:zip
```

O build espera o ZIP oficial da versão declarada em `package.json` dentro de `Wordpress/dist/`. Em um checkout limpo, gere primeiro as distribuições com `npm run wordpress:zip`.

O comando produz:

- `ChromeExtension/dist/kodety-studio/`, pronto para **Carregar sem compactação** em `chrome://extensions`;
- `ChromeExtension/dist/kodety-studio.zip`, pronto para distribuição e posterior extração.

O npm é necessário somente para desenvolver e empacotar a extensão. A pessoa que recebe a versão pronta não executa nenhum comando.

## Como funciona

- `@wp-playground/client` coordena PHP e WordPress compilados para WebAssembly.
- O ZIP do plugin vem sempre de `Wordpress/dist/<versão>.zip`, usando `kodety.wordpressVersion` do `package.json` como fonte de verdade.
- Os arquivos de cada WordPress usam um caminho OPFS exclusivo: `kodety-studio/projects/<id>`.
- A lista e os metadados dos projetos ficam em `chrome.storage.local`.
- Ao reabrir um projeto, o conteúdo persistido é montado de OPFS para o WordPress em memória; as alterações são sincronizadas de volta ao armazenamento persistente.
- A extensão é Manifest V3. O shell e a lógica de gerenciamento ficam no pacote; o runtime remoto executa isolado das APIs da extensão.

## Dependência de rede atual

O WordPress e os dados dos projetos rodam localmente no navegador, mas esta primeira versão carrega o documento de runtime em `https://playground.wordpress.net/remote.html`. Portanto, é necessário acesso à internet para iniciar o runtime. Um release totalmente offline exige hospedar e versionar esse runtime junto da infraestrutura Kodety.

O modo de rede do Playground também fica habilitado para que o WordPress consiga baixar temas, plugins e recursos quando solicitado.

Ao publicar na Chrome Web Store, declare o runtime remoto e entregue aos revisores a versão e o código-fonte correspondentes. A [política do Manifest V3](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements) isenta código executado em iframe isolado das APIs da extensão da proibição geral de código remoto, mas exige que a funcionalidade completa continue auditável.

## Limites importantes

- Limpar os dados de sites do Chrome pode apagar o OPFS. Faça exportações ou backups dos projetos importantes.
- Recursos que dependem de processos nativos do sistema, como `proc_open` ou `exec`, não existem no PHP WebAssembly.
- O armazenamento persistente do WordPress pertence ao origin do runtime do Playground e segue a quota que o Chrome conceder a esse origin; não existe promessa de espaço ilimitado nesta primeira versão.
- O runtime e o cliente devem ser atualizados como uma matriz de versões testada; atualizar apenas um deles pode quebrar a comunicação.

## Validação

```bash
npm run studio:test
```

O teste recompila a extensão e verifica o Manifest V3, as permissões, a política CSP, o isolamento por projeto, os sentidos de sincronização OPFS, a versão fixada do Playground e a identidade byte a byte entre `dist/assets/kodety.zip` e o ZIP oficial da versão Kodety declarada no repositório.
