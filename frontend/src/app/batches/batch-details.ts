import type { UploadResult } from '../uploads/upload-models';
import { Batch, BatchStatus, Organization, Stream } from './batch-models';

export interface RecoveryProgress {
  readonly expectedCalls: number;
  readonly receivedCalls: number;
}
export interface ProcessingProgress {
  readonly paused?: boolean;
  readonly pauseRequested?: boolean;
  readonly processedCalls: number;
  readonly totalCalls: number;
}
export interface BatchDetails {
  readonly processingProgress?: ProcessingProgress | null;
  readonly batch: Batch;
  readonly organization: Organization;
  readonly stream: Stream;
  readonly uploadId: string;
  readonly failure: string | null;
  readonly intake?: UploadResult;
  readonly recovery: RecoveryProgress | null;
}
export type BatchDetailsResult =
  { readonly kind: 'available'; readonly details: BatchDetails } | { readonly kind: 'not-found' };

export const BATCH_STATE_MESSAGES: Record<BatchStatus, string> = {
  restoring:
    'Восстанавливаем записи исходной загрузки. После восстановления батч ожидает ручного запуска командой Vox AI.',
  uploading: 'Загрузка ещё не завершена. Состав батча пока открыт; обработка не запущена.',
  ready: 'Ожидает ручного запуска командой Vox AI. Обработка ещё не началась.',
  queued: 'Команда Vox AI поставила батч в очередь. Он ожидает начала обработки.',
  processing:
    'Батч проходит обработку. Результаты будут опубликованы после завершения всего батча.',
  completed:
    'Обработка завершена. Результаты доступны в отчёте; отдельные ошибки записей не требуют восстановления батча.',
  upload_failed:
    'Первичный импорт ZIP не завершён. Исправьте архив и повторите импорт с тем же идентификатором загрузки.',
  batch_failed:
    'Обработка всего батча прервана. Для восстановления повторно передайте полный исходный набор уникальных записей в том же стриме.',
};
