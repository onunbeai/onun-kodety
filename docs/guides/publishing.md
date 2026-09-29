# Publicação no WordPress

O registro publicado contém versão, manifest, bundle ESM, source map, hash, dependências, autor e changelog. `prepareCodeComponentProject` grava bundles imutáveis sob `.coday/components/` e injeta um runtime modular nas páginas com `data-coday-code-instance`.

O bundle de produção precisa exportar `mountCodayComponent(container, props, context)`. O compiler gera esse contrato e o backend de publicação deve empacotar React, ReactDOM e imports permitidos. Assets são resolvidos pelo `PublicAssetResolver`; bindings pelo provider WordPress exposto como bridge pública. Valores de instância continuam JSON e nunca incluem React nodes ou funções.

Uma publicação deve rejeitar manifest/bundle com IDs ou versões divergentes, verificar o hash e manter a versão antiga para rollback.
