import { TranscriptSegment } from './report-models';

export const SPEAKER_LABELS: Readonly<Record<TranscriptSegment['role'], string>> = {
  employee: 'Сотрудник',
  customer: 'Клиент',
  unknown: 'Участник не определён',
};

export function roleFromRest(role: unknown): TranscriptSegment['role'] {
  return role === 'OPERATOR' ? 'employee' : role === 'CLIENT' ? 'customer' : 'unknown';
}
