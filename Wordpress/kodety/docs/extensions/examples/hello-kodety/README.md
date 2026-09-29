# Hello Onun Kodety

Exemplo instalável que demonstra:

- valor inicial criado no hook de ativação;
- leitura e gravação em Public Storage isolado;
- página **Onun Kodety → Hello Onun Kodety**, protegida por nonce e `manage_options`;
- `GET /wp-json/kodety/extensions/v1/hello-kodety/message`, protegido pela
  mesma capability;
- shortcode `[kodety_hello_kodety_message]`.

## Gerar o ZIP

Execute dentro desta pasta:

```bash
zip -X -r ../hello-kodety-1.0.0.zip kodety-extension.json extension.php README.md
```

Envie o ZIP em **Extensions → Install Extension** e ative. O pacote não depende
de arquivos externos e não toca no CMS nativo.

## Verificar

1. Abra a página administrativa e altere a mensagem.
2. Recarregue para confirmar a persistência.
3. Consulte o endpoint enquanto autenticado como administrador.
4. Insira `[kodety_hello_kodety_message]` em uma superfície WordPress que
   processe shortcodes.
5. Desative/ative novamente; o valor deve ser preservado.

Use este diretório como skeleton, mas troque slug, namespace, metadados,
permissions e capabilities. Não copie permissões que sua extensão não usa.

