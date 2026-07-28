/**
 * Utilitários de data com fuso fixo do produto (America/Sao_Paulo).
 *
 * Motivo: "hoje" precisa significar a mesma coisa no servidor, no web
 * e no celular do usuário. Sem um fuso fixo, o mesmo registro de água
 * cairia em dias diferentes dependendo de onde a conta é feita — o que
 * quebra streak, meta diária e relatórios semanais.
 */

import { APP_TIMEZONE } from '../constants/app.js';

/** Chave de dia no formato `YYYY-MM-DD`, no fuso do produto. */
export type DayKey = string;

/** Converte um instante para a chave do dia correspondente em São Paulo. */
export function toDayKey(date: Date = new Date(), timeZone: string = APP_TIMEZONE): DayKey {
  // `en-CA` produz exatamente YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Início do dia (00:00:00 no fuso do produto) como instante UTC. */
export function startOfDay(date: Date = new Date(), timeZone: string = APP_TIMEZONE): Date {
  const dayKey = toDayKey(date, timeZone);
  return new Date(`${dayKey}T00:00:00${getTimeZoneOffset(date, timeZone)}`);
}

/** Fim do dia (23:59:59.999 no fuso do produto) como instante UTC. */
export function endOfDay(date: Date = new Date(), timeZone: string = APP_TIMEZONE): Date {
  const dayKey = toDayKey(date, timeZone);
  return new Date(`${dayKey}T23:59:59.999${getTimeZoneOffset(date, timeZone)}`);
}

/**
 * Offset do fuso no formato `+HH:MM` para a data indicada.
 * Calculado dinamicamente porque o offset pode mudar (horário de verão).
 */
export function getTimeZoneOffset(date: Date, timeZone: string = APP_TIMEZONE): string {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
  const part = formatter.formatToParts(date).find((p) => p.type === 'timeZoneName');
  const raw = part?.value ?? 'GMT-03:00';
  const offset = raw.replace('GMT', '');
  return offset === '' ? '+00:00' : offset;
}

/** Início da semana (segunda-feira) que contém a data. */
export function startOfWeek(date: Date = new Date(), timeZone: string = APP_TIMEZONE): Date {
  const dayStart = startOfDay(date, timeZone);
  // getUTCDay: 0=domingo … 6=sábado. Queremos segunda como início.
  const weekday = dayStart.getUTCDay();
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  return new Date(dayStart.getTime() - daysSinceMonday * MS_PER_DAY);
}

export const MS_PER_DAY = 86_400_000;

/** Diferença em dias inteiros entre duas chaves de dia. */
export function daysBetween(from: DayKey, to: DayKey): number {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  return Math.round((toMs - fromMs) / MS_PER_DAY);
}

/** true se as duas datas caem no mesmo dia no fuso do produto. */
export function isSameDay(a: Date, b: Date, timeZone: string = APP_TIMEZONE): boolean {
  return toDayKey(a, timeZone) === toDayKey(b, timeZone);
}

/** Data ISO em UTC — formato usado em todo o tráfego da API. */
export function toIsoString(date: Date = new Date()): string {
  return date.toISOString();
}
