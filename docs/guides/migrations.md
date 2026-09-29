# Versionamento e migrations

Versões publicadas são imutáveis. Instâncias apontam para uma versão exata até o usuário escolher atualizar. O registry encontra uma cadeia de migrations de `from` até `to`, executa-a sobre uma cópia dos props e oferece preview antes de persistir.

Migrations são código confiável do pacote, não JSON. Cada etapa precisa ser determinística, não acessar rede e preservar propriedades desconhecidas quando possível. O editor mantém o snapshot anterior para rollback. Sem cadeia completa a atualização é marcada incompatível e não pode ser aplicada automaticamente.
