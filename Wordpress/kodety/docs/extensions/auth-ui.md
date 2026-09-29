# Autenticação, permissions, capabilities e UI

Há três camadas distintas:

1. `permissions` autoriza uma superfície da Extension API;
2. `capabilities` declara quais decisões WordPress a extensão pode solicitar;
3. o usuário atual precisa possuir a capability no momento da operação.

Nenhuma camada concede a seguinte implicitamente.

## Auth

```php
$auth = $extension->auth();

if (!$auth->is_authenticated()) return;
$user_id = $auth->user_id();
if (!$auth->can('manage_options')) return;

$nonce = $auth->create_nonce('save-settings');
$valid = $auth->verify_nonce($_POST['_nonce'] ?? '', 'save-settings');
```

Todos os métodos exigem `auth.read`. `can()` também exige a capability no
manifesto. Nonces são automaticamente namespaced pelo slug. Nonce prova intenção
da sessão, não autorização: sempre chame `can()` para mutations.

Prefira capabilities específicas do produto/feature em vez de roles ou
`manage_options` quando houver uma capability apropriada. Nunca baseie acesso
em nome de usuário, email ou label da role.

## UI mínima

`ui.render` disponibiliza helpers estáveis de HTML administrativo:

```php
$ui = $extension->ui();
echo $ui->notice('Configurações salvas.', 'success');
echo $ui->button('Voltar', $extension->admin()->url('projects'), false);
echo $ui->field('Nome', '<input name="name" value="' . esc_attr($name) . '">');
```

Tipos de notice: `info`, `success`, `warning` e `error`. `field()` não altera o
HTML do controle; o chamador precisa escapar todos os valores interpolados.

Os helpers são deliberadamente pequenos. Não use componentes, imports, stores,
rotas React ou classes PHP internas do Onun Kodety. Extensões com UI rica devem
empacotar seu CSS/JS, manter acessibilidade, oferecer fallback server-side e
tratar a interface como aplicação própria dentro da página registrada.

## Requests administrativos

Em toda mutation:

- confirme método HTTP;
- normalize e sanitize input;
- verifique nonce;
- verifique capability;
- valide regras de negócio e ownership;
- grave somente no namespace da extensão;
- redirecione após POST ou retorne resposta REST explícita;
- escape mensagens e nunca exponha exceptions diretamente.

