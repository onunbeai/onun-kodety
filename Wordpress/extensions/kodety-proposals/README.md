# Onun Kodety Proposals

Addon opcional e independente do CMS para propostas comerciais dinâmicas.

## Fluxo

1. Instale e ative `kodety-proposals.zip` em Extensões.
2. No Builder, abra **Pages**, o menu de uma página e escolha **Template → Proposta**.
3. Selecione os elementos dessa página e conecte cada um às variáveis no painel **Proposta**.
4. Abra `/proposta/criar/`, preencha os dados e publique.
5. Compartilhe a URL `/proposta/{slug}/`.

O addon mantém tipos, dados, endpoints, respostas e o caminho do template em
opções próprias. Ele não cria collections, fields ou mappings em
`kodety_cms_templates`. Ao desativá-lo, **Template → Proposta** desaparece do
Builder sem alterar o template de CMS existente.
