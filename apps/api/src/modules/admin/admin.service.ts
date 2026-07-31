/**
 * Consultas operacionais que alimentam os workflows do N8N.
 *
 * Estas rotas não existem para uma tela — existem para automação. O
 * formato de saída é ditado pelos workflows em `infra/n8n/workflows/`,
 * que já esperam nomes de campo específicos. Mudar um nome aqui quebra o
 * workflow em silêncio, no horário agendado, sem ninguém olhando.
 */

import { Injectable } from '@nestjs/common';
import { toDayKey } from '@atlas/shared';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

/** Um aluno que se mexeu no período — consumido pelo relatório semanal. */
export interface ActiveUser {
  id: string;
  name: string;
  email: string;
}

/** Consumido por `03-analise-hidratacao`: os nomes vêm do workflow. */
export interface HydrationBelowGoal {
  userId: string;
  name: string;
  goalMl: number;
  totalMl: number;
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Alunos com atividade nos últimos `days` dias.
   *
   * "Ativo" aqui é ter registrado treino OU hidratação — não é ter
   * conta. Gerar relatório semanal para quem não apareceu produz um
   * documento vazio e ainda paga a chamada de IA.
   */
  async listActiveUsers(days = 7): Promise<ActiveUser[]> {
    const desde = new Date(Date.now() - days * 86_400_000);

    const usuarios = await this.prisma.db.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [
          { workoutLogs: { some: { startedAt: { gte: desde }, deletedAt: null } } },
          { hydrationLogs: { some: { consumedAt: { gte: desde }, deletedAt: null } } },
        ],
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });

    return usuarios;
  }

  /**
   * Quem ainda não bateu a meta de água HOJE.
   *
   * O corte é o dia corrente porque o lembrete só faz sentido enquanto
   * dá para agir: avisar às 20:00 sobre ontem não muda nada.
   *
   * A soma vai por `dayKey` (a coluna de data já materializada) em vez de
   * um intervalo sobre `loggedAt` — é o que o índice cobre, e evita a
   * discussão de fuso na fronteira da meia-noite.
   */
  async listBelowWaterGoal(): Promise<HydrationBelowGoal[]> {
    const hoje = toDayKey(new Date());

    const usuarios = await this.prisma.db.user.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true, dailyWaterGoalMl: true },
    });

    if (usuarios.length === 0) return [];

    const somas = await this.prisma.db.hydrationLog.groupBy({
      by: ['userId'],
      where: { dayKey: hoje, deletedAt: null, userId: { in: usuarios.map((u) => u.id) } },
      _sum: { amountMl: true },
    });

    const consumido = new Map(somas.map((s) => [s.userId, s._sum.amountMl ?? 0]));

    return (
      usuarios
        .map((u) => ({
          userId: u.id,
          name: u.name,
          goalMl: u.dailyWaterGoalMl,
          totalMl: consumido.get(u.id) ?? 0,
        }))
        // Quem já bateu não entra: o workflow também filtra, mas mandar
        // essas linhas só para ele descartar é tráfego e tempo à toa.
        .filter((u) => u.totalMl < u.goalMl)
    );
  }
}
