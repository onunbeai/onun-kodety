# Catálogo de controles

Primitivos: String, Text, Number, Boolean, Enum, Color, Image, File, Link e Date.

Compostos: Spacing, Radius, Border, Shadow, Typography, Transform, Effects e Layout. Layout diferencia `stack`, `grid`, `free` e `diagonal`; diagonal possui ângulo, offset, origem, alinhamento, direção e rotação de itens.

Estruturais: Object, Array, Slot e Slots. Arrays usam `itemTitleAdapter`, nunca funções persistidas. Slots persistem IDs de instância/camada e o runtime rejeita ciclos.

Todos os controles aceitam título, descrição, categoria, ordem e condições declarativas. Controles compatíveis podem declarar `responsive: true` e `bindable: true`.
