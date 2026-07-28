# Atlas Admin

Painel administrativo — usado por **administradores de academia** e pelo
**administrador geral**.

> **Esta fase entrega apenas o scaffold.** Ver
> [`docs/task-list-frontend.md`](../../docs/task-list-frontend.md).

## Escopo previsto

**Administrador de academia** (`GYM_ADMIN`)

- cadastrar e editar alunos
- criar treinos e periodizações
- acompanhar evolução dos alunos
- gerenciar professores

**Administrador geral** (`SUPER_ADMIN`)

- cadastrar e bloquear academias
- administrar o catálogo global de exercícios
- visualizar logs de auditoria
- acompanhar sincronizações e resolver conflitos pendentes
- gerenciar os workflows do N8N

## Telas que dependem de rotas já prontas

| Tela                                         | Rota da API              |
| -------------------------------------------- | ------------------------ |
| Estado da sincronização                      | `GET /api/sync/status`   |
| Disparo manual de sincronização              | `POST /api/sync/trigger` |
| Saúde do sistema                             | `GET /api/health`        |
| Listagem de usuários (escopada por academia) | `GET /api/users`         |

O RBAC já está aplicado no back-end: use `PERMISSIONS` de `@atlas/shared`
para esconder na UI exatamente o que a API também recusaria.
