# ACME Example

Exemplo mínimo de extensão Onun Kodety. Ele:

- registra callbacks idempotentes de ativação e desativação;
- persiste uma configuração somente pela API de extensões;
- adiciona o shortcode namespaced `[kodety_acme_example_message]`;
- escapa a saída pública;
- não escreve arquivos nem executa código dinâmico;
- declara somente `storage.read`, `storage.write` e `frontend.register`.

Para criar o ZIP individual, compacte **o conteúdo desta pasta**, mantendo
`kodety-extension.json` na raiz do arquivo:

```sh
cd example-extension
zip -r acme-example.zip kodety-extension.json extension.php README.md
```

Envie `acme-example.zip` em **Onun Kodety → Extensões**. O exemplo exige Onun Kodety
1.0.17, Extension API 1.0.0 e PHP 8.0 ou superiores.
