# Packaging e instalação por ZIP

## Pacote individual

```text
vendor-feature.zip
├── kodety-extension.json
├── extension.php
├── includes/
└── assets/
```

Uma única pasta externa também é aceita. Não inclua uma segunda raiz com outro
manifesto.

Exemplo reproduzível, executado dentro da pasta da extensão:

```bash
zip -X -r ../vendor-feature-1.2.0.zip . \
  -x '.DS_Store' '.git/*' 'node_modules/*' 'tests/*' '*.map'
```

`-X` remove metadados extras. Gere o ZIP a partir de uma árvore limpa, confira
`unzip -l` e calcule SHA-256 para distribuição.

## Validações do instalador

- arquivo ZIP de até 256 MB;
- até 2.000 arquivos e 256 MB descompactados;
- cada arquivo com até 32 MB;
- somente extensões de arquivo permitidas;
- nenhum caminho absoluto, `..`, NUL ou link simbólico;
- manifesto válido, entrypoint existente e slug não reservado;
- PHP, Onun Kodety e Extension API compatíveis;
- somente permissões públicas conhecidas;
- bundle inteiro validado antes do commit.

O código PHP não é executado durante a validação/instalação. Pacotes novos são
instalados inativos.

## Bundle

```text
vendor-suite.zip
├── kodety-bundle.json
└── packages/
    ├── vendor-base.zip
    └── vendor-feature.zip
```

```json
{
  "schemaVersion": 1,
  "type": "bundle",
  "packages": ["packages/vendor-base.zip", "packages/vendor-feature.zip"]
}
```

Bundles contêm de 1 a 50 ZIPs individuais e não podem conter outro bundle.
Slugs duplicados ou um único pacote inválido rejeitam toda a operação.

## Segredos e supply chain

Não empacote `.env`, tokens, chaves privadas, dumps ou credentials. Fixe versões
de dependências, mantenha SBOM/licenças quando aplicável, assine checksums no
canal de distribuição e instale somente pacotes revisados. PHP de extensão é
trusted code no processo WordPress, não conteúdo sandboxed.
