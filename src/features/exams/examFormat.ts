import type { AytAlan } from '@/domain/types';

const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Formats a stored `YYYY-MM-DD` date without timezone shifts. */
export function formatExamDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) {
    return value;
  }
  return dateFormatter.format(new Date(year, month - 1, day));
}

export const AYT_ALAN_LABELS: Readonly<Record<AytAlan, string>> = {
  sayisal: 'Sayısal',
  ea: 'Eşit Ağırlık',
  sozel: 'Sözel',
  tumu: 'Genel',
};

export function formatAlan(alan: AytAlan | undefined): string | null {
  return alan ? AYT_ALAN_LABELS[alan] : null;
}

export function sumNet(results: ReadonlyArray<{ net: number }>): number {
  return results.reduce((sum, result) => {
    // A pre-v8 sync could store `net` as a decimal string. Coercing here keeps
    // a stale local row from turning every total into concatenation/NaN.
    const net = Number(result.net);
    return Number.isFinite(net) ? sum + net : sum;
  }, 0);
}
