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
import { SyncService } from './sync.service.js';

@Injectable()
export class SyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(SyncScheduler.name);

  constructor(
    private readonly syncService: SyncService,
    private readonly config: EnvConfig,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    if (!this.config.sync.enabled) {
      this.logger.warn('Sincronização agendada desabilitada (SYNC_ENABLED=false).');
      return;
    }

    this.schedule('atlas-sync-morning', this.config.sync.cronMorning);
    this.schedule('atlas-sync-evening', this.config.sync.cronEvening);
  }

  private schedule(name: string, cronExpression: string): void {
    const job = new CronJob(
      cronExpression,
      () => {
        void this.execute(name);
      },
      null,
      false,
      APP_TIMEZONE,
    );

    this.registry.addCronJob(name, job as never);
    job.start();

    this.logger.log(`Sincronização agendada "${name}": ${cronExpression} (${APP_TIMEZONE}).`);
  }

  private async execute(name: string): Promise<void> {
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
}
