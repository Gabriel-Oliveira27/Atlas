/**
 * Agendamento da sincronização — 03:00 e 18:00 (America/Sao_Paulo),
 * conforme a especificação.
 *
 * Os horários vêm do ambiente, mas o fuso é fixo no fuso do produto:
 * "03:00" precisa significar 3h da manhã no Brasil, independentemente
 * do fuso do servidor que hospeda a API.
 */

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { APP_TIMEZONE, SYNC_DIRECTION, SYNC_TRIGGER } from '@atlas/shared';
import { EnvConfig } from '../../config/env.config.js';
import { SyncRetentionService } from './sync-retention.service.js';
import { SyncService } from './sync.service.js';

@Injectable()
export class SyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(SyncScheduler.name);

  constructor(
    private readonly syncService: SyncService,
    private readonly retention: SyncRetentionService,
    private readonly config: EnvConfig,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    if (!this.config.sync.enabled) {
      this.logger.warn('Sincronização agendada desabilitada (SYNC_ENABLED=false).');
      return;
    }

    this.schedule('atlas-sync-morning', this.config.sync.cronMorning, () =>
      this.executeSync('atlas-sync-morning'),
    );
    this.schedule('atlas-sync-evening', this.config.sync.cronEvening, () =>
      this.executeSync('atlas-sync-evening'),
    );

    if (!this.config.sync.retentionEnabled) {
      this.logger.warn('Poda de retenção desabilitada (SYNC_RETENTION_ENABLED=false).');
      return;
    }

    // Depois da janela da madrugada, de propósito: o que a sincronização
    // das 03:00 acabou de marcar como SYNCED já entra na conta do dia em
    // que completar a idade, e a poda nunca corre junto com quem escreve.
    this.schedule('atlas-sync-retention', this.config.sync.retentionCron, () =>
      this.executeRetention(),
    );
  }

  private schedule(name: string, cronExpression: string, task: () => Promise<void>): void {
    const job = new CronJob(
      cronExpression,
      () => {
        void task();
      },
      null,
      false,
      APP_TIMEZONE,
    );

    this.registry.addCronJob(name, job as never);
    job.start();

    this.logger.log(`Sincronização agendada "${name}": ${cronExpression} (${APP_TIMEZONE}).`);
  }

  private async executeSync(name: string): Promise<void> {
    this.logger.log(`Disparando sincronização agendada: ${name}`);

    try {
      await this.syncService.run({
        trigger: SYNC_TRIGGER.SCHEDULED,
        direction: SYNC_DIRECTION.BIDIRECTIONAL,
      });
    } catch (error) {
      // Uma execução que falha não pode derrubar o agendador — a próxima
      // janela precisa continuar valendo.
      this.logger.error({ err: error }, `Sincronização agendada "${name}" falhou.`);
    }
  }

  private async executeRetention(): Promise<void> {
    this.logger.log('Disparando poda de retenção do rastro de sincronização.');

    try {
      await this.retention.prune();
    } catch (error) {
      // Mesmo princípio: a poda é manutenção. Falhar hoje só significa
      // que amanhã tem um pouco mais para apagar.
      this.logger.error({ err: error }, 'Poda de retenção falhou.');
    }
  }
}
