# Responsividade e CMS

`ResponsiveValue<T>` guarda `base` e overrides por breakpoint. A resolução percorre a linhagem do breakpoint primário até o ativo e faz merge raso em valores compostos. Remover um override restaura imediatamente o valor herdado.

Bindings são separados dos valores estáticos. Dentro de uma collection, `current-collection` resolve o campo do item corrente; por isso uma prop String pode usar o título e uma prop Image pode usar o asset do mesmo item. O inspector lista apenas campos compatíveis, preserva fallback estático e atualiza o runtime quando o provider dispara mudanças.

Fontes aceitas: collection atual, item específico, query, variável global, parâmetro de URL, usuário autenticado e função de servidor. Funções de servidor são identificadas por ID; código ou credenciais nunca são persistidos na instância.
