/**
 * Tela inicial — agrega tudo que a Home exibe em UMA chamada.
 *
 * A alternativa (o app fazer 6 requisições) multiplicaria a latência
 * de abertura, que é a métrica mais visível do produto. As consultas
 * rodam em paralelo e a maior parte já vem pré-calculada em
 * `DailyActivity`.
 */

import { Injectable } from '@nestjs/common';
import { AppError, toDayKey } from '@atlas/shared';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

@Injectable()
export class HomeService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(userId: string, gymId: string | null) {
    const db = this.prisma.db;
    const dayKey = toDayKey();
    const weekStartKey = toDayKey(new Date(Date.now() - 6 * 86_400_000));

    const [user, todayActivity, openSession, weekActivities, tips, announcements, lastReport] =
      await Promise.all([
        db.user.findFirst({
          where: { id: userId, deletedAt: null },
          select: {
            name: true,
            avatarUrl: true,
            weightKg: true,
            targetWeightKg: true,
            dailyWaterGoalMl: true,
            goal: true,
          },
        }),
        db.dailyActivity.findUnique({ where: { userId_dayKey: { userId, dayKey } } }),
        db.workoutLog.findFirst({
          where: { userId, status: 'IN_PROGRESS', deletedAt: null },
          select: { id: true, startedAt: true, workoutDay: { select: { label: true } } },
        }),
        db.dailyActivity.findMany({
          where: { userId, dayKey: { gte: weekStartKey, lte: dayKey } },
          orderBy: { dayKey: 'asc' },
        }),
        db.tip.findMany({ where: { isActive: true }, take: 3, orderBy: { createdAt: 'desc' } }),
        db.announcement.findMany({
          where: {
            isActive: true,
            startsAt: { lte: new Date() },
            // Duas condições independentes precisam de AND explícito —
            // duas chaves `OR` no mesmo objeto se sobrescreveriam.
            AND: [
              { OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] },
              gymId ? { OR: [{ gymId }, { gymId: null }] } : { gymId: null },
            ],
          },
          take: 5,
          orderBy: { startsAt: 'desc' },
        }),
        db.weeklyReport.findFirst({
          where: { userId, status: 'COMPLETED', deletedAt: null },
          orderBy: { periodStart: 'desc' },
          select: { id: true, periodStart: true, periodEnd: true, summary: true, pdfUrl: true },
        }),
      ]);

    if (!user) throw AppError.notFound('Usuário', userId);

    const hydrationTotal = todayActivity?.hydrationTotalMl ?? 0;
    const hydrationGoal = todayActivity?.hydrationGoalMl ?? user.dailyWaterGoalMl;

    return {
      user: {
        name: user.name,
        avatarUrl: user.avatarUrl,
        goal: user.goal,
      },
      hydration: {
        totalMl: hydrationTotal,
        goalMl: hydrationGoal,
        remainingMl: Math.max(0, hydrationGoal - hydrationTotal),
        percentage:
          hydrationGoal > 0 ? Math.min(100, Math.round((hydrationTotal / hydrationGoal) * 100)) : 0,
        goalReached: todayActivity?.hydrationGoalMet ?? false,
      },
      workout: {
        inProgress: Boolean(openSession),
        session: openSession,
        completedToday: todayActivity?.workoutCompleted ?? false,
        countToday: todayActivity?.workoutCount ?? 0,
      },
      weight: {
        currentKg: user.weightKg,
        targetKg: user.targetWeightKg,
        remainingKg:
          user.weightKg && user.targetWeightKg
            ? Number((user.weightKg - user.targetWeightKg).toFixed(2))
            : null,
      },
      streak: todayActivity?.streak ?? 0,
      weeklyProgress: weekActivities.map((activity) => ({
        dayKey: activity.dayKey,
        workoutCompleted: activity.workoutCompleted,
        hydrationGoalMet: activity.hydrationGoalMet,
        volumeLoad: activity.volumeLoad,
      })),
      tips,
      announcements,
      lastWeeklyReport: lastReport,
      // Sinaliza contingência para o app avisar o usuário de que está
      // operando com o banco em nuvem.
      degraded: this.prisma.isDegraded,
    };
  }
}
