# Versionamento

Há três versões independentes:

- `version`: release da extensão;
- `requires.kodety`: produto mínimo necessário;
- `requires.extensionApi`: contrato público mínimo necessário.

Use SemVer para a extensão e para o contrato público. A API v1 aceita apenas um
limite mínimo simples; não há limite máximo no manifesto.

## Política da Extension API

- mudanças compatíveis incrementam minor/patch e preservam métodos existentes;
- remoção, mudança de assinatura ou semântica incompatível exige novo major;
- correções de segurança podem tornar input antes tolerado inválido quando isso
  fecha uma vulnerabilidade;
- APIs internas não recebem garantia, mesmo que sejam public PHP por necessidade
  do WordPress.

Declare o menor nível realmente necessário. Uma extensão que usa somente v1.0
deve declarar `>=1.0.0`, não a versão presente na máquina do autor.

## Releases da extensão

- patch: bugfix sem migration destrutiva;
- minor: recurso compatível e campos opcionais;
- major: mudança de schema/contrato que exige ação do integrador.

Mantenha changelog com migrations, novas permissions/capabilities, endpoints e
impactos de frontend. Alterar permissões é uma mudança relevante que precisa de
revisão do usuário, mesmo em release compatível.

Nunca reutilize uma mesma versão para bytes diferentes. Produza ZIP determinístico
quando possível e publique checksum.

