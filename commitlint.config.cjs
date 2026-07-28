/**
 * Convenção de commits do Atlas (Conventional Commits).
 * Exemplos:
 *   feat(api): adiciona login com Google
 *   fix(database): corrige índice de HydrationLog
 *   docs(arch): documenta estratégia de sincronização
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'api',
        'web',
        'mobile',
        'admin',
        'database',
        'auth',
        'shared',
        'validation',
        'ai',
        'config',
        'ui',
        'infra',
        'docker',
        'n8n',
        'docs',
        'ci',
        'deps',
        'sync',
        'release',
      ],
    ],
    'subject-case': [0],
    'header-max-length': [2, 'always', 120],
  },
};
