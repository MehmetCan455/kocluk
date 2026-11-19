import type { ExamType } from '@/domain/types';

export function examBasePath(exam: ExamType): string {
  return exam === 'TYT' ? '/tyt' : '/ayt';
}

export function examTitle(exam: ExamType): string {
  return exam === 'TYT' ? 'TYT Dersleri' : 'AYT Dersleri';
}
