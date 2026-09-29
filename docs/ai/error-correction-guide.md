# Guia de correção de erros

## `manifest-controls`

Mova o objeto de controles para dentro de `defineComponent` ou para o segundo argumento literal de `addPropertyControls`. Não construa o schema por função.

## `import-not-allowed`

Remova a dependência ou solicite inclusão explícita na allowlist. Nunca substitua por CDN arbitrária.

## `invalid-pattern` ou default inválido

Corrija o schema e o default juntos. Não faça cast para esconder incompatibilidade.

## Prop sem controle

Registre a prop ou remova-a da interface pública configurável. Props reservadas da SDK não precisam de controle.

## Função não serializável

Troque callbacks persistidos por identificadores de adapter, eventos ou bindings.

## Ciclo de slot

Conecte uma camada fora da árvore da instância. Não clone IDs para contornar a validação.

## Erro SSR

Mova acesso a browser para `useEffect`, teste disponibilidade e forneça markup inicial determinístico.

## Resize loop

Não derive largura intrínseca de uma altura que o canvas deriva novamente da largura. Escolha um eixo autoritativo no sizing.
