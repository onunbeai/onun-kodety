# Regras de validação

- O arquivo deve ser parseável como TSX estrito e exportar um componente funcional.
- `id`, `version`, `controls`, `sizing` e `events` precisam ser extraíveis estaticamente.
- Toda importação deve estar na allowlist; imports dinâmicos usam literal.
- Todo default precisa passar pelo adapter do controle.
- `min <= max`, `step > 0`, counts não negativos e opções/títulos/ícones têm cardinalidade compatível.
- Condições referenciam paths existentes e usam apenas operadores declarativos.
- `responsive: true` somente em valores serializáveis.
- Bindings precisam ser compatíveis com o tipo do controle; fallback passa pela mesma validação.
- Arrays usam `itemTitleAdapter`; schemas não contêm funções.
- Slots não aceitam a própria instância nem ancestrais.
- Manifest e instância não contêm `undefined`, função, ReactNode persistido ou ciclos.
- O bundle não excede o limite, não importa Node e exporta `mountCodayComponent` após compilação.
- Efeitos limpam recursos e código de render não depende de APIs de browser.
