export interface ScheduleDay {
  day: number;
  label: string;
  short: string;
}

/** ISO weekday order: Monday is 1 and Sunday is 7. */
export const SCHEDULE_DAYS: readonly ScheduleDay[] = [
  { day: 1, label: 'Pazartesi', short: 'Pzt' },
  { day: 2, label: 'Salı', short: 'Sal' },
  { day: 3, label: 'Çarşamba', short: 'Çar' },
  { day: 4, label: 'Perşembe', short: 'Per' },
  { day: 5, label: 'Cuma', short: 'Cum' },
  { day: 6, label: 'Cumartesi', short: 'Cmt' },
  { day: 7, label: 'Pazar', short: 'Paz' },
];

/** Zero-based index into `SCHEDULE_DAYS` for the device's current day. */
export function todayScheduleDayIndex(now: Date = new Date()): number {
  return (now.getDay() + 6) % 7;
}
