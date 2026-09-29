# Kodety Interaction Recorder

Extensão Chrome Manifest V3 para captura assistida de sites Framer, Webflow e aplicações React.

## Perfis automáticos

- **Webflow:** preserva jQuery/Webflow.js, IX2, `data-w-id`, `data-wf-page`, componentes, formulários e código inline. O runtime original continua responsável pelas interações.
- **Código:** preserva scripts clássicos, módulos, código inline e normaliza URLs relativas para o endereço publicado.
- **Framer:** remove a hidratação React incompatível com o DOM estático e usa o runtime gravado em modo conservador.

## Instalação local

1. Abra `chrome://extensions`.
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação**.
4. Selecione a pasta `ChromeExtension/kodety-recorder`.

## Uso

1. Abra o site que será importado.
2. Clique na extensão e em **Iniciar captura**.
3. Passe o mouse nos estados Hover, pressione botões, abra componentes, use tabs/accordions, role a página e redimensione a janela nos breakpoints importantes.
4. Clique em **Parar** e depois em **Compilar e baixar ZIP**.
5. No Kodety Builder use **Importar projeto ZIP**.

A gravação continua ativa ao recarregar a mesma aba. Isso permite iniciar a captura, recarregar a página e registrar animações de entrada desde o início.

## Isolamento e rede

- O recorder roda somente no mundo `ISOLATED` da extensão. Comandos e status usam `chrome.runtime`; não existe bridge por `window.postMessage`, `MessageChannel` nem API de controle exposta à página.
- O service worker não baixa folhas CSS nem o HTML original. O `index.html` vem do DOM capturado e mantém as URLs remotas que a própria página já usava; apenas o snapshot MHTML é solicitado diretamente ao Chrome.
- Animações são observadas a cada `requestAnimationFrame`, durante a gravação e numa janela inicial de 30 segundos desde `document_start`, além dos eventos `animationstart` e `transitionrun`. Nenhum prototype do mundo principal da página é alterado.
- O envelope enviado ao documento offscreen tem limite combinado de 48 MiB medidos em UTF-8. O MHTML é limitado a 4 MiB e omitido quando faria o envelope exceder esse orçamento; a validação ocorre antes do envio e novamente no destino.

## Conteúdo do ZIP

- `index.html`: DOM final sem scripts do site original.
- `styles/kodety-recorded-interactions.css`: estados Hover, Active e Focus observados.
- `styles/kodety-recorded-responsive.css`: media queries acessíveis preservadas como código.
- `styles/kodety-recorded-external.css`: arquivo vazio de compatibilidade; os links remotos continuam no `index.html` capturado.
- `scripts/kodety-recorded-runtime.js`: runtime editável que reproduz WAAPI, CSS animations/transitions, hover, pressed, focus, click, scroll e trocas de variante.
- `.incode/framer-import.json`: metadados de compatibilidade; no Recorder v2 o Builder mantém o comportamento em código.
- `.incode/kodety-recorder.json`: eventos, mutações estruturais, componentes, scroll, viewports e assets.
- `source/original-page.mhtml`: snapshot completo produzido pelo Chrome, quando disponível.

## Limites do MVP

- O ZIP mantém URLs de assets no HTML e inclui o MHTML como snapshot. A localização individual dos recursos será feita pelo importador Kodety em uma próxima etapa.
- A reprodução é baseada nas interações efetivamente executadas durante a gravação. Variantes ou estados nunca visitados não podem ser inferidos.
- Sites protegidos pelo navegador (`chrome://`, Chrome Web Store e páginas internas) não podem ser gravados.
