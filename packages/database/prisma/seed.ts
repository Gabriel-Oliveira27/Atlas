/**
 * Seed do Atlas.
 *
 * Popula o mínimo necessário para o sistema funcionar de ponta a ponta:
 * papéis, permissões, grupos musculares, músculos, equipamentos, um
 * conjunto inicial de exercícios e um administrador geral.
 *
 * É IDEMPOTENTE (tudo via `upsert`): rodar duas vezes não duplica nada,
 * o que permite reexecutar depois de adicionar itens novos.
 *
 *   pnpm db:seed
 */

import { PrismaClient, type RoleName } from '@prisma/client';
import { formatActivationCode, generateActivationCode } from '@atlas/auth';
import {
  ROLE_PERMISSIONS,
  ALL_PERMISSIONS,
  ROLES,
  formatCpf,
  isValidCpf,
  normalizeCpf,
} from '@atlas/shared';

const prisma = new PrismaClient();

/** Nó de origem dos dados semeados. */
const SEED_NODE = process.env.NODE_ID ?? 'seed';

async function seedPermissions() {
  console.info('→ Permissões...');

  for (const code of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      update: {},
      create: { code, description: describePermission(code) },
    });
  }

  console.info(`  ${ALL_PERMISSIONS.length} permissões garantidas.`);
}

async function seedRoles() {
  console.info('→ Papéis e vínculos de permissão...');

  const descriptions: Record<RoleName, string> = {
    USER: 'Aluno — registra treinos, hidratação e acompanha a evolução',
    PROFESSOR: 'Professor — cria treinos e acompanha alunos da academia',
    GYM_ADMIN: 'Administrador da academia — gerencia alunos, professores e treinos',
    SUPER_ADMIN: 'Administrador geral — gerencia academias, catálogo e plataforma',
  };

  for (const roleName of Object.values(ROLES) as RoleName[]) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: { description: descriptions[roleName] },
      create: { name: roleName, description: descriptions[roleName] },
    });

    const permissionCodes = ROLE_PERMISSIONS[roleName] ?? [];
    const permissions = await prisma.permission.findMany({
      where: { code: { in: [...permissionCodes] } },
    });

    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }

    console.info(`  ${roleName}: ${permissions.length} permissões.`);
  }
}

/** Grupos musculares e seus subgrupos. */
const MUSCLE_GROUPS: Array<{
  name: string;
  slug: string;
  position: number;
  children?: Array<{ name: string; slug: string }>;
  muscles: Array<{ name: string; slug: string; latinName?: string }>;
}> = [
  {
    name: 'Peito',
    slug: 'peito',
    position: 1,
    children: [
      { name: 'Peitoral superior', slug: 'peitoral-superior' },
      { name: 'Peitoral medial', slug: 'peitoral-medial' },
      { name: 'Peitoral inferior', slug: 'peitoral-inferior' },
    ],
    muscles: [
      { name: 'Peitoral maior', slug: 'peitoral-maior', latinName: 'Pectoralis major' },
      { name: 'Peitoral menor', slug: 'peitoral-menor', latinName: 'Pectoralis minor' },
    ],
  },
  {
    name: 'Costas',
    slug: 'costas',
    position: 2,
    children: [
      { name: 'Dorsal', slug: 'dorsal' },
      { name: 'Trapézio', slug: 'trapezio' },
      { name: 'Lombar', slug: 'lombar' },
    ],
    muscles: [
      { name: 'Grande dorsal', slug: 'grande-dorsal', latinName: 'Latissimus dorsi' },
      { name: 'Trapézio', slug: 'musculo-trapezio', latinName: 'Trapezius' },
      { name: 'Romboides', slug: 'romboides', latinName: 'Rhomboidei' },
      { name: 'Eretor da espinha', slug: 'eretor-da-espinha', latinName: 'Erector spinae' },
    ],
  },
  {
    name: 'Ombros',
    slug: 'ombros',
    position: 3,
    children: [
      { name: 'Deltoide anterior', slug: 'deltoide-anterior' },
      { name: 'Deltoide lateral', slug: 'deltoide-lateral' },
      { name: 'Deltoide posterior', slug: 'deltoide-posterior' },
    ],
    muscles: [
      { name: 'Deltoide', slug: 'deltoide', latinName: 'Deltoideus' },
      { name: 'Manguito rotador', slug: 'manguito-rotador', latinName: 'Rotator cuff' },
    ],
  },
  {
    name: 'Bíceps',
    slug: 'biceps',
    position: 4,
    muscles: [
      { name: 'Bíceps braquial', slug: 'biceps-braquial', latinName: 'Biceps brachii' },
      { name: 'Braquial', slug: 'braquial', latinName: 'Brachialis' },
      { name: 'Braquiorradial', slug: 'braquiorradial', latinName: 'Brachioradialis' },
    ],
  },
  {
    name: 'Tríceps',
    slug: 'triceps',
    position: 5,
    muscles: [{ name: 'Tríceps braquial', slug: 'triceps-braquial', latinName: 'Triceps brachii' }],
  },
  {
    name: 'Pernas',
    slug: 'pernas',
    position: 6,
    children: [
      { name: 'Quadríceps', slug: 'quadriceps' },
      { name: 'Posterior de coxa', slug: 'posterior-de-coxa' },
      { name: 'Glúteos', slug: 'gluteos' },
      { name: 'Panturrilhas', slug: 'panturrilhas' },
    ],
    muscles: [
      { name: 'Quadríceps femoral', slug: 'quadriceps-femoral', latinName: 'Quadriceps femoris' },
      { name: 'Isquiotibiais', slug: 'isquiotibiais', latinName: 'Hamstrings' },
      { name: 'Glúteo máximo', slug: 'gluteo-maximo', latinName: 'Gluteus maximus' },
      { name: 'Gastrocnêmio', slug: 'gastrocnemio', latinName: 'Gastrocnemius' },
      { name: 'Sóleo', slug: 'soleo', latinName: 'Soleus' },
    ],
  },
  {
    name: 'Abdômen',
    slug: 'abdomen',
    position: 7,
    muscles: [
      { name: 'Reto abdominal', slug: 'reto-abdominal', latinName: 'Rectus abdominis' },
      { name: 'Oblíquos', slug: 'obliquos', latinName: 'Obliquus' },
      {
        name: 'Transverso do abdômen',
        slug: 'transverso-abdomen',
        latinName: 'Transversus abdominis',
      },
    ],
  },
];

const EQUIPMENT = [
  { name: 'Barra', slug: 'barra' },
  { name: 'Halteres', slug: 'halteres' },
  { name: 'Máquina', slug: 'maquina' },
  { name: 'Cabo / Polia', slug: 'cabo-polia' },
  { name: 'Peso corporal', slug: 'peso-corporal' },
  { name: 'Kettlebell', slug: 'kettlebell' },
  { name: 'Elástico', slug: 'elastico' },
  { name: 'Banco', slug: 'banco' },
  { name: 'Smith', slug: 'smith' },
  { name: 'Anilha', slug: 'anilha' },
];

async function seedCatalog() {
  console.info('→ Grupos musculares, músculos e equipamentos...');

  for (const group of MUSCLE_GROUPS) {
    const parent = await prisma.muscleGroup.upsert({
      where: { slug: group.slug },
      update: { name: group.name, position: group.position },
      create: { name: group.name, slug: group.slug, position: group.position },
    });

    for (const [index, child] of (group.children ?? []).entries()) {
      await prisma.muscleGroup.upsert({
        where: { slug: child.slug },
        update: { name: child.name, parentId: parent.id, position: index },
        create: { name: child.name, slug: child.slug, parentId: parent.id, position: index },
      });
    }

    for (const muscle of group.muscles) {
      await prisma.muscle.upsert({
        where: { slug: muscle.slug },
        update: { name: muscle.name, muscleGroupId: parent.id },
        create: {
          name: muscle.name,
          slug: muscle.slug,
          ...(muscle.latinName ? { latinName: muscle.latinName } : {}),
          muscleGroupId: parent.id,
        },
      });
    }
  }

  for (const item of EQUIPMENT) {
    await prisma.equipment.upsert({
      where: { slug: item.slug },
      update: { name: item.name },
      create: item,
    });
  }

  console.info(`  ${MUSCLE_GROUPS.length} grupos e ${EQUIPMENT.length} equipamentos.`);
}

/** Exercícios iniciais — o suficiente para montar um ABC completo. */
const EXERCISES = [
  {
    name: 'Supino reto com barra',
    slug: 'supino-reto-barra',
    groupSlug: 'peito',
    subGroupSlug: 'peitoral-medial',
    muscles: [
      { slug: 'peitoral-maior', role: 'PRIMARY' as const },
      { slug: 'triceps-braquial', role: 'SECONDARY' as const },
      { slug: 'deltoide', role: 'SECONDARY' as const },
    ],
    equipment: ['barra', 'banco'],
    mechanic: 'COMPOUND' as const,
    force: 'PUSH' as const,
    difficulty: 'INTERMEDIATE' as const,
    execution:
      'Deite no banco com os pés firmes no chão e as escápulas retraídas. Segure a barra com pegada ' +
      'um pouco mais aberta que a largura dos ombros. Desça a barra de forma controlada até tocar levemente ' +
      'a região do peitoral médio, mantendo os cotovelos a cerca de 45 graus do tronco. Empurre a barra ' +
      'de volta à posição inicial sem travar os cotovelos.',
    commonMistakes: [
      'Quicar a barra no peito',
      'Abrir os cotovelos a 90 graus, sobrecarregando o ombro',
      'Tirar os quadris do banco para ganhar impulso',
    ],
    tips: [
      'Mantenha as escápulas retraídas durante toda a série',
      'Os pés firmes no chão dão estabilidade e transferem força',
    ],
    stimulus: { hypertrophy: 5, strength: 5, endurance: 2, caloric: 3, tension: 5, stability: 3 },
  },
  {
    name: 'Supino inclinado com halteres',
    slug: 'supino-inclinado-halteres',
    groupSlug: 'peito',
    subGroupSlug: 'peitoral-superior',
    muscles: [
      { slug: 'peitoral-maior', role: 'PRIMARY' as const },
      { slug: 'deltoide', role: 'SECONDARY' as const },
      { slug: 'triceps-braquial', role: 'SECONDARY' as const },
    ],
    equipment: ['halteres', 'banco'],
    mechanic: 'COMPOUND' as const,
    force: 'PUSH' as const,
    difficulty: 'BEGINNER' as const,
    execution:
      'Ajuste o banco entre 30 e 45 graus. Com um haltere em cada mão, desça de forma controlada até ' +
      'sentir o alongamento do peitoral, mantendo os punhos alinhados aos cotovelos. Empurre os halteres ' +
      'para cima aproximando-os levemente no topo, sem batê-los.',
    commonMistakes: ['Inclinar o banco acima de 45 graus, transformando em exercício de ombro'],
    tips: ['Halteres permitem maior amplitude que a barra'],
    stimulus: { hypertrophy: 5, strength: 4, endurance: 2, caloric: 3, tension: 4, stability: 4 },
  },
  {
    name: 'Puxada frontal na polia',
    slug: 'puxada-frontal-polia',
    groupSlug: 'costas',
    subGroupSlug: 'dorsal',
    muscles: [
      { slug: 'grande-dorsal', role: 'PRIMARY' as const },
      { slug: 'biceps-braquial', role: 'SECONDARY' as const },
      { slug: 'romboides', role: 'SECONDARY' as const },
    ],
    equipment: ['cabo-polia', 'maquina'],
    mechanic: 'COMPOUND' as const,
    force: 'PULL' as const,
    difficulty: 'BEGINNER' as const,
    execution:
      'Sente-se com as coxas travadas sob o apoio. Segure a barra com pegada pronada mais aberta que ' +
      'os ombros. Puxe a barra até a altura da clavícula, levando os cotovelos para baixo e para trás e ' +
      'juntando as escápulas. Retorne controlando a subida até estender os braços.',
    commonMistakes: ['Puxar a barra atrás da nuca', 'Usar impulso de tronco para vencer a carga'],
    tips: ['Pense em levar os cotovelos ao bolso, não em puxar com as mãos'],
    stimulus: { hypertrophy: 5, strength: 4, endurance: 3, caloric: 3, tension: 4, stability: 2 },
  },
  {
    name: 'Remada curvada com barra',
    slug: 'remada-curvada-barra',
    groupSlug: 'costas',
    subGroupSlug: 'dorsal',
    muscles: [
      { slug: 'grande-dorsal', role: 'PRIMARY' as const },
      { slug: 'romboides', role: 'PRIMARY' as const },
      { slug: 'eretor-da-espinha', role: 'STABILIZER' as const },
    ],
    equipment: ['barra'],
    mechanic: 'COMPOUND' as const,
    force: 'PULL' as const,
    difficulty: 'ADVANCED' as const,
    execution:
      'Em pé, incline o tronco cerca de 45 graus mantendo a coluna neutra e os joelhos levemente ' +
      'flexionados. Puxe a barra em direção ao abdômen, aproximando as escápulas. Desça controlando o movimento.',
    commonMistakes: ['Arredondar a coluna lombar', 'Subir o tronco junto com a barra'],
    tips: ['Se não consegue manter a coluna neutra, reduza a carga'],
    stimulus: { hypertrophy: 5, strength: 5, endurance: 2, caloric: 4, tension: 5, stability: 4 },
  },
  {
    name: 'Agachamento livre',
    slug: 'agachamento-livre',
    groupSlug: 'pernas',
    subGroupSlug: 'quadriceps',
    muscles: [
      { slug: 'quadriceps-femoral', role: 'PRIMARY' as const },
      { slug: 'gluteo-maximo', role: 'PRIMARY' as const },
      { slug: 'eretor-da-espinha', role: 'STABILIZER' as const },
    ],
    equipment: ['barra'],
    mechanic: 'COMPOUND' as const,
    force: 'PUSH' as const,
    difficulty: 'ADVANCED' as const,
    execution:
      'Posicione a barra sobre o trapézio. Com os pés na largura dos ombros e pontas levemente para fora, ' +
      'desça flexionando quadril e joelhos ao mesmo tempo, mantendo o tronco firme e a coluna neutra. ' +
      'Desça até a profundidade que conseguir manter sem perder a postura e suba empurrando o chão.',
    commonMistakes: [
      'Deixar os joelhos colapsarem para dentro',
      'Tirar os calcanhares do chão',
      'Arredondar a lombar no fundo do movimento',
    ],
    tips: ['Empurre o chão para longe em vez de pensar em "subir"'],
    stimulus: { hypertrophy: 5, strength: 5, endurance: 3, caloric: 5, tension: 5, stability: 5 },
  },
  {
    name: 'Leg press 45°',
    slug: 'leg-press-45',
    groupSlug: 'pernas',
    subGroupSlug: 'quadriceps',
    muscles: [
      { slug: 'quadriceps-femoral', role: 'PRIMARY' as const },
      { slug: 'gluteo-maximo', role: 'SECONDARY' as const },
    ],
    equipment: ['maquina'],
    mechanic: 'COMPOUND' as const,
    force: 'PUSH' as const,
    difficulty: 'BEGINNER' as const,
    execution:
      'Apoie os pés na plataforma na largura dos ombros. Destrave o equipamento e desça controlando até ' +
      'aproximadamente 90 graus de flexão do joelho, sem tirar o quadril do apoio. Empurre a plataforma ' +
      'sem travar os joelhos ao final.',
    commonMistakes: ['Descer demais e descolar o quadril do encosto', 'Travar os joelhos no topo'],
    tips: ['Mantenha a lombar apoiada no encosto o tempo todo'],
    stimulus: { hypertrophy: 5, strength: 4, endurance: 3, caloric: 4, tension: 4, stability: 2 },
  },
  {
    name: 'Desenvolvimento com halteres',
    slug: 'desenvolvimento-halteres',
    groupSlug: 'ombros',
    subGroupSlug: 'deltoide-anterior',
    muscles: [
      { slug: 'deltoide', role: 'PRIMARY' as const },
      { slug: 'triceps-braquial', role: 'SECONDARY' as const },
    ],
    equipment: ['halteres', 'banco'],
    mechanic: 'COMPOUND' as const,
    force: 'PUSH' as const,
    difficulty: 'INTERMEDIATE' as const,
    execution:
      'Sentado com o encosto vertical, segure os halteres na altura dos ombros com as palmas para frente. ' +
      'Empurre acima da cabeça até quase estender os cotovelos e desça controlando até a posição inicial.',
    commonMistakes: ['Arquear a lombar para vencer a carga'],
    tips: ['Mantenha o abdômen contraído para proteger a lombar'],
    stimulus: { hypertrophy: 5, strength: 4, endurance: 2, caloric: 3, tension: 4, stability: 3 },
  },
  {
    name: 'Elevação lateral',
    slug: 'elevacao-lateral',
    groupSlug: 'ombros',
    subGroupSlug: 'deltoide-lateral',
    muscles: [{ slug: 'deltoide', role: 'PRIMARY' as const }],
    equipment: ['halteres'],
    mechanic: 'ISOLATION' as const,
    force: 'PUSH' as const,
    difficulty: 'BEGINNER' as const,
    execution:
      'Em pé, com um haltere em cada mão ao lado do corpo, eleve os braços lateralmente até a altura dos ' +
      'ombros mantendo leve flexão de cotovelo. Desça controlando o movimento.',
    commonMistakes: ['Usar impulso de tronco', 'Subir acima da linha dos ombros'],
    tips: ['Carga baixa e execução controlada rendem mais que peso alto neste exercício'],
    stimulus: { hypertrophy: 4, strength: 2, endurance: 3, caloric: 2, tension: 3, stability: 2 },
  },
  {
    name: 'Rosca direta com barra',
    slug: 'rosca-direta-barra',
    groupSlug: 'biceps',
    muscles: [
      { slug: 'biceps-braquial', role: 'PRIMARY' as const },
      { slug: 'braquial', role: 'SECONDARY' as const },
    ],
    equipment: ['barra'],
    mechanic: 'ISOLATION' as const,
    force: 'PULL' as const,
    difficulty: 'BEGINNER' as const,
    execution:
      'Em pé, segure a barra com pegada supinada na largura dos ombros. Flexione os cotovelos mantendo-os ' +
      'junto ao tronco, sem balançar o corpo. Desça controlando até estender os braços.',
    commonMistakes: ['Balançar o tronco', 'Afastar os cotovelos do corpo'],
    tips: ['A fase de descida é onde ocorre boa parte do estímulo — não a acelere'],
    stimulus: { hypertrophy: 4, strength: 3, endurance: 3, caloric: 2, tension: 4, stability: 1 },
  },
  {
    name: 'Tríceps na polia com corda',
    slug: 'triceps-polia-corda',
    groupSlug: 'triceps',
    muscles: [{ slug: 'triceps-braquial', role: 'PRIMARY' as const }],
    equipment: ['cabo-polia'],
    mechanic: 'ISOLATION' as const,
    force: 'PUSH' as const,
    difficulty: 'BEGINNER' as const,
    execution:
      'De frente para a polia alta, segure a corda com os cotovelos junto ao tronco. Estenda os cotovelos ' +
      'até a extensão completa, afastando as pontas da corda no final. Retorne controlando.',
    commonMistakes: ['Mover os cotovelos para frente', 'Inclinar o tronco para empurrar a carga'],
    tips: ['Cotovelos travados ao lado do corpo isolam melhor o tríceps'],
    stimulus: { hypertrophy: 4, strength: 3, endurance: 3, caloric: 2, tension: 3, stability: 1 },
  },
  {
    name: 'Prancha abdominal',
    slug: 'prancha-abdominal',
    groupSlug: 'abdomen',
    muscles: [
      { slug: 'transverso-abdomen', role: 'PRIMARY' as const },
      { slug: 'reto-abdominal', role: 'SECONDARY' as const },
    ],
    equipment: ['peso-corporal'],
    mechanic: 'ISOLATION' as const,
    force: 'STATIC' as const,
    difficulty: 'BEGINNER' as const,
    execution:
      'Apoie antebraços e pontas dos pés no chão, formando uma linha reta da cabeça aos calcanhares. ' +
      'Contraia abdômen e glúteos e sustente a posição pelo tempo determinado, respirando normalmente.',
    commonMistakes: ['Elevar o quadril', 'Deixar a lombar afundar'],
    tips: ['Qualidade da posição vale mais que tempo total'],
    stimulus: { hypertrophy: 2, strength: 3, endurance: 5, caloric: 2, tension: 2, stability: 5 },
  },
  {
    name: 'Levantamento terra',
    slug: 'levantamento-terra',
    groupSlug: 'costas',
    subGroupSlug: 'lombar',
    muscles: [
      { slug: 'eretor-da-espinha', role: 'PRIMARY' as const },
      { slug: 'gluteo-maximo', role: 'PRIMARY' as const },
      { slug: 'isquiotibiais', role: 'PRIMARY' as const },
      { slug: 'grande-dorsal', role: 'STABILIZER' as const },
    ],
    equipment: ['barra', 'anilha'],
    mechanic: 'COMPOUND' as const,
    force: 'PULL' as const,
    difficulty: 'ADVANCED' as const,
    execution:
      'Com a barra sobre o meio dos pés, flexione o quadril e os joelhos para segurá-la mantendo a coluna ' +
      'neutra e o peito aberto. Estenda joelhos e quadril ao mesmo tempo, mantendo a barra rente ao corpo. ' +
      'Desça refazendo o caminho com controle.',
    commonMistakes: [
      'Arredondar a coluna lombar',
      'Afastar a barra do corpo durante a subida',
      'Hiperestender a lombar no topo',
    ],
    tips: ['Se a coluna arredondar, a carga está alta demais — reduza'],
    stimulus: { hypertrophy: 5, strength: 5, endurance: 2, caloric: 5, tension: 5, stability: 5 },
  },
];

async function seedExercises() {
  console.info('→ Exercícios...');

  for (const item of EXERCISES) {
    const group = await prisma.muscleGroup.findUnique({ where: { slug: item.groupSlug } });
    if (!group) throw new Error(`Grupo muscular não encontrado: ${item.groupSlug}`);

    const subGroup = item.subGroupSlug
      ? await prisma.muscleGroup.findUnique({ where: { slug: item.subGroupSlug } })
      : null;

    const exercise = await prisma.exercise.upsert({
      where: { slug: item.slug },
      update: {
        name: item.name,
        execution: item.execution,
        commonMistakes: item.commonMistakes,
        tips: item.tips,
      },
      create: {
        name: item.name,
        slug: item.slug,
        execution: item.execution,
        mechanic: item.mechanic,
        force: item.force,
        difficulty: item.difficulty,
        muscleGroupId: group.id,
        ...(subGroup ? { muscleSubGroupId: subGroup.id } : {}),
        commonMistakes: item.commonMistakes,
        tips: item.tips,
        stimulusHypertrophy: item.stimulus.hypertrophy,
        stimulusStrength: item.stimulus.strength,
        stimulusEndurance: item.stimulus.endurance,
        stimulusCaloricExpenditure: item.stimulus.caloric,
        stimulusMechanicalTension: item.stimulus.tension,
        stimulusStability: item.stimulus.stability,
        originNode: SEED_NODE,
      },
    });

    for (const muscleRef of item.muscles) {
      const muscle = await prisma.muscle.findUnique({ where: { slug: muscleRef.slug } });
      if (!muscle) continue;

      await prisma.exerciseMuscle.upsert({
        where: { exerciseId_muscleId: { exerciseId: exercise.id, muscleId: muscle.id } },
        update: { role: muscleRef.role },
        create: { exerciseId: exercise.id, muscleId: muscle.id, role: muscleRef.role },
      });
    }

    for (const equipmentSlug of item.equipment) {
      const equipment = await prisma.equipment.findUnique({ where: { slug: equipmentSlug } });
      if (!equipment) continue;

      await prisma.exerciseEquipment.upsert({
        where: {
          exerciseId_equipmentId: { exerciseId: exercise.id, equipmentId: equipment.id },
        },
        update: {},
        create: { exerciseId: exercise.id, equipmentId: equipment.id },
      });
    }
  }

  console.info(`  ${EXERCISES.length} exercícios garantidos.`);
}

/**
 * Administrador geral.
 *
 * A conta nasce **sem senha**, com um código de ativação. Quem abrir o
 * Atlas pela primeira vez informa o CPF, recebe o aviso de primeiro
 * acesso e cria a própria senha — ninguém precisa saber, digitar ou
 * versionar uma senha padrão.
 *
 * O código aparece só aqui, no terminal. Rodar o seed de novo gera um
 * novo código, desde que a conta ainda não tenha senha; se já tiver, o
 * seed não mexe (não faria sentido derrubar o acesso de quem já entrou).
 */
async function seedAdminUser() {
  console.info('→ Administrador geral...');

  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@atlas.local';
  const cpf = normalizeCpf(process.env.SEED_ADMIN_CPF ?? '02515718310');
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });

  if (!cpf || !isValidCpf(cpf)) {
    throw new Error(`SEED_ADMIN_CPF inválido: ${process.env.SEED_ADMIN_CPF ?? '(padrão)'}`);
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { cpf }] },
    select: { id: true, passwordHash: true, email: true },
  });

  if (existing?.passwordHash) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { roleId: role.id, isActive: true, cpf },
    });

    console.info(`  ${existing.email} · CPF ${formatCpf(cpf)}`);
    console.info('  já tem senha definida — o seed não a altera.');
    return;
  }

  const activation = generateActivationCode();

  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      roleId: role.id,
      isActive: true,
      cpf,
      activationCodeHash: activation.hash,
      activationExpiresAt: activation.expiresAt,
    },
    create: {
      email,
      cpf,
      name: 'Administrador Atlas',
      roleId: role.id,
      activationCodeHash: activation.hash,
      activationExpiresAt: activation.expiresAt,
      originNode: SEED_NODE,
    },
  });

  const validade = activation.expiresAt.toLocaleDateString('pt-BR');

  console.info(`  ${admin.email}`);
  console.info('');
  console.info('  ┌──────────────────────────────────────────────┐');
  console.info(`  │  Entre com o CPF   ${formatCpf(cpf)}             │`);
  console.info(`  │  Código de ativação   ${formatActivationCode(activation.code)}             │`);
  console.info('  └──────────────────────────────────────────────┘');
  console.info('');
  console.info(`  O código vale até ${validade} e some assim que a senha for criada.`);
}

async function seedSystemDefaults() {
  console.info('→ Configurações e dicas...');

  await prisma.appConfig.upsert({
    where: { key: 'app.defaults' },
    update: {},
    create: {
      key: 'app.defaults',
      value: {
        dailyWaterGoalMl: 2450,
        weeklyReportDay: 1, // segunda-feira
        syncTimes: ['03:00', '18:00'],
      },
    },
  });

  const tips = [
    {
      title: 'Constância vence intensidade',
      content:
        'Treinar de forma moderada quatro vezes por semana rende mais no longo prazo do que dois treinos ' +
        'exaustivos seguidos de uma semana parado.',
      category: 'treino',
    },
    {
      title: 'Hidratação não espera a sede',
      content:
        'A sensação de sede aparece quando o corpo já está em déficit. Distribua o consumo ao longo do dia ' +
        'em vez de concentrar tudo no treino.',
      category: 'hidratacao',
    },
    {
      title: 'Registre a carga em toda série',
      content:
        'O histórico de cargas é o que permite enxergar a evolução e ajustar o treino. Sem registro, a ' +
        'progressão vira suposição.',
      category: 'treino',
    },
  ];

  for (const tip of tips) {
    const existing = await prisma.tip.findFirst({ where: { title: tip.title } });
    if (!existing) await prisma.tip.create({ data: tip });
  }

  console.info(`  ${tips.length} dicas garantidas.`);
}

function describePermission(code: string): string {
  const [resource, action, scope] = code.split(':');
  const scopeLabel = scope === 'any' ? ' (qualquer usuário/academia)' : '';
  return `Permite ${action} em ${resource}${scopeLabel}`;
}

async function main() {
  console.info('\n═══ Seed do Atlas ═══\n');

  await seedPermissions();
  await seedRoles();
  await seedCatalog();
  await seedExercises();
  await seedAdminUser();
  await seedSystemDefaults();

  console.info('\n✓ Seed concluído.\n');
}

main()
  .catch((error) => {
    console.error('\n✗ Falha no seed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
