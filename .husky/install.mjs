// Instala os hooks do git — mas só onde eles fazem sentido.
//
// O `prepare` roda em todo `pnpm install`, inclusive na hospedagem. Lá,
// `NODE_ENV=production` faz o pnpm pular as devDependencies, então o
// husky não está instalado e chamá-lo direto derruba o build inteiro:
//
//   . prepare$ husky
//   . prepare: sh: 1: husky: not found
//    ELIFECYCLE  Command failed.
//
// Sair antes do import é o que a documentação do husky 9 recomenda para
// esse caso. A alternativa comum (`husky || true`) também não derruba,
// mas deixa o "not found" no log — e um erro de verdade no husky passaria
// igualmente batido.
//
// Hook nenhum é perdido: em servidor e em CI não existe commit para
// interceptar. Quem desenvolve continua tendo pre-commit e commit-msg.
if (process.env.NODE_ENV === 'production' || process.env.CI === 'true') {
  process.exit(0);
}

const husky = (await import('husky')).default;
console.log(husky());
