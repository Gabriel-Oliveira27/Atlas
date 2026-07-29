/**
 * Escopo por usuário e por academia.
 *
 * O `RbacGuard` responde "este papel pode executar esta ação?". Ele
 * NÃO responde "sobre QUEM?" — e essa segunda pergunta é a que impede
 * um professor da academia A de ler ou escrever dados de um aluno da
 * academia B.
 *
 * Antes, cada service precisava lembrar de fazer essa checagem por
 * conta própria, e bastava um esquecimento para vazar dado entre
 * academias. Toda rota que aceita um `userId` de fora agora passa por
 * aqui.
 */

import { Injectable } from '@nestjs/common';
import { canAccessUserData } from '@atlas/auth';
import { AppError, type AuthenticatedUser } from '@atlas/shared';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

@Injectable()
export class UserScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Devolve o id do usuário sobre o qual a operação vai agir.
   *
   * Sem `targetUserId`, ou quando ele aponta para o próprio
   * solicitante, o resultado é o próprio solicitante — o caso comum,
   * que não custa consulta ao banco. Com um alvo diferente, valida o
   * escopo e lança 403 quando não houver permissão.
   */
  async resolveTargetUserId(
    requester: AuthenticatedUser,
    targetUserId?: string | null,
  ): Promise<string> {
    if (!targetUserId || targetUserId === requester.id) return requester.id;

    await this.assertCanAccess(requester, targetUserId);
    return targetUserId;
  }

  /** Lança 403 se o solicitante não puder agir sobre o usuário-alvo. */
  async assertCanAccess(requester: AuthenticatedUser, targetUserId: string): Promise<void> {
    if (targetUserId === requester.id) return;

    const target = await this.prisma.db.user.findFirst({
      where: { id: targetUserId, deletedAt: null },
      select: {
        id: true,
        memberships: { where: { isActive: true }, select: { gymId: true } },
      },
    });

    if (!target) throw AppError.notFound('Usuário', targetUserId);

    const allowed = canAccessUserData(
      {
        userId: requester.id,
        role: requester.role,
        permissions: requester.permissions,
        gymId: requester.gymId,
      },
      { userId: target.id, gymId: target.memberships[0]?.gymId ?? null },
    );

    if (!allowed) {
      throw AppError.forbidden('Você não tem acesso aos dados deste usuário');
    }
  }
}
