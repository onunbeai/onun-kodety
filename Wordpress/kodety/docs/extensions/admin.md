# Páginas administrativas

`admin.register` permite criar páginas sem acessar o shell interno do Onun Kodety.
Por padrão, páginas aparecem sob o menu `kodety`; passe `parent => null` para
um menu superior próprio.

```php
$page_slug = $extension->admin()->register_page('projects', [
    'title' => 'Projects',
    'menu_title' => 'Projects',
    'capability' => 'manage_options',
    'callback' => static function (Kodety_Extension_Context $extension): string {
        return '<div class="wrap"><h1>' . esc_html__('Projects', 'vendor-feature') . '</h1></div>';
    },
]);
```

O manifesto precisa declarar:

```json
{
  "permissions": ["admin.register"],
  "capabilities": ["manage_options"]
}
```

A API gera `kodety-extension-{slug}-{page}`, registra no `admin_menu` e verifica
a capability novamente antes de renderizar. O callback pode imprimir ou
retornar HTML. Todo conteúdo variável continua sendo responsabilidade da
extensão: valide request, use nonces e escape no contexto correto.

Opções aceitas:

| Chave | Uso |
| --- | --- |
| `title` | `<title>` e heading conceitual da página. Obrigatória. |
| `menu_title` | Label do menu. Obrigatória. |
| `capability` | Capability declarada no manifesto. Obrigatória. |
| `callback` | Callable que recebe o contexto. Obrigatória. |
| `parent` | Slug do menu pai; padrão `kodety`; `null` cria top-level. |
| `icon` | Dashicon para top-level. |
| `position` | Posição numérica para top-level. |

Obtenha a URL com `$extension->admin()->url('projects')`. Não codifique
`admin.php?page=...` manualmente.

## Falha de renderização

A API renderiza o callback dentro de um buffer. Se ele lançar um `Throwable`,
todo output parcial é descartado, a falha é registrada com o slug e a surface
`admin.render`, e o usuário vê apenas uma notice segura indicando a extensão e
orientando a consultar os logs. Mensagem e trace da exception não entram no
HTML. Retornos e output normais são preservados.

Validação de definition, permission e capability ocorre no registro e continua
lançando os erros documentados; o fallback cobre somente a execução de um
callback que já foi registrado com sucesso.

## Formulários

Use `$extension->auth()->create_nonce('save-project')` e verifique com
`verify_nonce()` antes de gravar. Depois, autorize a operação com `can()`. Nonce
previne CSRF; ele não substitui autorização.

Para respostas assíncronas prefira uma rota REST autenticada, não `admin-ajax`.
Não importe React, CSS ou componentes privados do Builder. A API v1 estabiliza
helpers HTML mínimos em `ui()`; aplicações maiores devem empacotar seus próprios
assets e componentes.
