export type AccessRole = 'customer' | 'team';
export type BatchStatus =
  | 'uploading'
  | 'ready'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'upload_failed'
  | 'batch_failed'
  | 'restoring';

export interface Organization {
  readonly id: string;
  readonly name: string;
}
export interface Stream {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
}
export interface Workspace {
  readonly role: AccessRole;
  readonly organizations: readonly Organization[];
}
export interface BatchQuery {
  readonly organizationId: string;
  readonly streamId: string;
}
export interface Batch {
  readonly maxTotal?: number;
  readonly id: string;
  readonly uploadId?: string;
  readonly organizationId: string;
  readonly streamId: string;
  readonly name: string;
  readonly filename: string;
  readonly createdAt: string;
  readonly status: BatchStatus;
  readonly acceptedCalls: number;
  readonly averageTotal: number | null;
}

export const BATCH_STATUSES: Record<
  BatchStatus,
  { readonly label: string; readonly tone: string }
> = {
  uploading: { label: 'Загружается', tone: 'neutral' },
  restoring: { label: 'Восстанавливается', tone: 'neutral' },
  ready: { label: 'Готов к запуску', tone: 'neutral' },
  queued: { label: 'В очереди', tone: 'blue' },
  processing: { label: 'Обрабатывается', tone: 'blue' },
  completed: { label: 'Завершён', tone: 'green' },
  upload_failed: { label: 'Ошибка загрузки', tone: 'red' },
  batch_failed: { label: 'Ошибка батча', tone: 'red' },
};
