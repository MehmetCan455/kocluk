import { newId } from '@/lib/id';
import type {
  ScheduleTable,
  ScheduleTableDayCells,
  ScheduleTableDoneCells,
  ScheduleTableRow,
} from './types';

/** The manual table is stored as a single Dexie record. */
export const SCHEDULE_TABLE_ID = 'main';
export const SCHEDULE_TABLE_TOTAL_LABEL = 'TOPLAM SÜRE/SORU';
export const SCHEDULE_TABLE_DEFAULT_ROWS = 5;
export const SCHEDULE_TABLE_MAX_ROWS = 50;
export const SCHEDULE_TABLE_SUBJECT_MAX_LENGTH = 80;
export const SCHEDULE_TABLE_CELL_MAX_LENGTH = 120;
export const SCHEDULE_TABLE_TOTAL_MAX_LENGTH = 80;
export const SCHEDULE_TABLE_NOTE_MAX_LENGTH = 2000;

export function emptyScheduleTableDays(): ScheduleTableDayCells {
  return ['', '', '', '', '', '', ''];
}

export function emptyScheduleTableDoneCells(): ScheduleTableDoneCells {
  return [false, false, false, false, false, false, false];
}

export function createEmptyScheduleRow(): ScheduleTableRow {
  return {
    id: newId(),
    subject: '',
    days: emptyScheduleTableDays(),
    done: emptyScheduleTableDoneCells(),
    total: '',
  };
}

/**
 * A fresh manual table with the five empty rows the page starts with. The
 * `updatedAt` stays empty until the user saves it for the first time.
 */
export function createEmptyScheduleTable(): ScheduleTable {
  return {
    id: SCHEDULE_TABLE_ID,
    rows: Array.from({ length: SCHEDULE_TABLE_DEFAULT_ROWS }, createEmptyScheduleRow),
    totals: {
      label: SCHEDULE_TABLE_TOTAL_LABEL,
      days: emptyScheduleTableDays(),
      total: '',
    },
    note: '',
    updatedAt: '',
  };
}
