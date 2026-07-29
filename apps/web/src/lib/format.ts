/** Formatação de datas e números — sempre em pt-BR, fuso do produto. */

export function formatTime(value: string | Date): string {
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export function formatFullDate(value: string | Date): string {
  return new Date(value).toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
}

/** "2026-07-28" → data local ao meio-dia (evita voltar um dia por fuso). */
export function dayKeyToDate(dayKey: string): Date {
  return new Date(`${dayKey}T12:00:00`);
}

export function formatDuration(totalSeconds: number): string {
  // Abaixo de um minuto mostramos segundos: "0 min" numa sessão de 40 s
  // parece dado faltando, não sessão curta.
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}min`;
}

/** Cronômetro mm:ss para o descanso entre séries. */
export function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatVolume(volumeKg: number): string {
  if (volumeKg >= 1000) {
    return `${(volumeKg / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t`;
  }
  return `${Math.round(volumeKg).toLocaleString('pt-BR')} kg`;
}

export function formatWeight(weightKg: number): string {
  return weightKg.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}
