import { AccessRole } from '../batches/batch-models';
import { HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, switchMap, throwError } from 'rxjs';
import { BatchDetailsSource } from '../batches/batch-details-source';
import { BatchDetailsResult } from '../batches/batch-details';
import {
  RestoreRequest,
  RestoreResult,
  UploadRequest,
  UploadResult,
  UploadsSource,
  UploadFieldError,
} from '../uploads/upload-models';
import { ApiConnection, connectionError } from './api-connection';
import { BatchDto, batchFromRest } from './rest-report-models';

interface IntakeItem {
  status: 'accepted' | 'duplicate' | 'rejected';
  original_name: string;
  duplicate_of?: string;
  error?: { code: string; message: string };
}
interface BatchStateDto extends BatchDto {
  error: string | null;
}
interface ArchiveDto extends BatchStateDto {
  items: IntakeItem[];
}

const errorMessages: Record<string, string> = {
  invalid_archive: 'Файл не удалось прочитать как ZIP. Выберите исправленный архив.',
  empty_archive: 'ZIP не содержит файлов.',
  encrypted_archive: 'Нужен ZIP без пароля.',
  invalid_metadata: 'Проверьте JSON-метаданные и соответствие путей файлам архива.',
  invalid_audio: 'Файл не удалось прочитать как аудио.',
  no_audio_stream: 'В файле нет аудиодорожки.',
  unsafe_archive_entry: 'Недопустимый путь или тип файла в ZIP.',
  unreadable_archive_entry: 'Файл в ZIP повреждён или имеет неподдерживаемое сжатие.',
  metadata_conflict:
    'Метаданные расходятся с сохранёнными значениями. Исправьте их или уберите файл метаданных.',
  composition_conflict: 'Состав записей расходится с исходным батчем. Передайте исходные записи.',
  restoration_incomplete:
    'Принята только часть исходных записей. Для завершения восстановления передайте полный набор.',
  upload_conflict:
    'Этот идентификатор уже связан с другим стримом или архивом. Для независимой загрузки начните новую.',
  upload_in_progress: 'Сервер ещё принимает эту загрузку. Обновите сведения перед повтором.',
  audio_probe_unavailable: 'Сервис проверки аудио недоступен. Приём мог завершиться частично.',
  batch_processing_failed: 'Обработка батча прервана.',
  worker_interrupted: 'Обработка прервана после остановки обработчика.',
  no_accepted_records: 'Ни одной записи не принято.',
};
export function uploadErrorCode(error: unknown): string | null {
  return error instanceof HttpErrorResponse ? (error.error?.error?.code ?? null) : null;
}
export function uploadErrorMessage(error: unknown): string {
  const code = uploadErrorCode(error);
  return code
    ? (errorMessages[code] ?? `Сервер отклонил запрос (${code}).`)
    : connectionError(error);
}
export function editableUploadError(error: unknown): boolean {
  return error instanceof HttpErrorResponse && (error.status === 422 || error.status === 409);
}
export function uploadFieldError(error: unknown): UploadFieldError | null {
  const code = uploadErrorCode(error);
  const field =
    code &&
    [
      'invalid_archive',
      'empty_archive',
      'encrypted_archive',
      'composition_conflict',
      'restoration_incomplete',
      'upload_conflict',
    ].includes(code)
      ? 'archive'
      : null;
  return field ? { field, message: uploadErrorMessage(error) } : null;
}
function intakeFromRest(dto: ArchiveDto): UploadResult {
  return {
    uploadId: dto.upload_id,
    batch: batchFromRest(dto),
    accepted: dto.items.filter((i) => i.status === 'accepted').map((i) => i.original_name),
    duplicates: dto.items
      .filter((i) => i.status === 'duplicate')
      .map((i) => ({ filename: i.original_name, original: i.duplicate_of ?? '' })),
    errors: dto.items
      .filter((i) => i.status === 'rejected')
      .map((i) => ({
        filename: i.original_name,
        reason: i.error ? (errorMessages[i.error.code] ?? i.error.message) : 'Ошибка файла',
      })),
  };
}

@Injectable({ providedIn: 'root' })
export class RestBatchDetailsSource extends BatchDetailsSource {
  private readonly connection = inject(ApiConnection);
  batchDetails(_role: AccessRole, batchId: string): Observable<BatchDetailsResult> {
    const path = `/batches/${encodeURIComponent(batchId)}`;
    return this.connection.get<BatchStateDto>(path).pipe(
      switchMap((batch) =>
        forkJoin({
          stream: this.connection.get<{ stream_id: string; customer_id: string; name: string }>(
            `/streams/${encodeURIComponent(batch.stream_id)}`,
          ),
          organization: this.connection.access()!.organization
            ? of(this.connection.access()!.organization!)
            : this.connection
                .get<{ customer_id: string; name: string }>(
                  `/customers/${encodeURIComponent(batch.customer_id)}`,
                )
                .pipe(map((c) => ({ id: c.customer_id, name: c.name }))),
          files: this.connection.get<{ items: IntakeItem[] }>(path + '/files'),
        }).pipe(
          map(({ stream, organization, files }): BatchDetailsResult => ({
            kind: 'available',
            details: {
              batch: batchFromRest(batch),
              organization,
              stream: {
                id: stream.stream_id,
                organizationId: stream.customer_id,
                name: stream.name,
              },
              uploadId: batch.upload_id,
              recovery: null,
              failure:
                ['batch_failed', 'upload_failed', 'restoring', 'uploading'].includes(
                  batch.status,
                ) && batch.error
                  ? (errorMessages[batch.error] ?? batch.error)
                  : null,
              intake: intakeFromRest({ ...batch, items: files.items }),
            },
          })),
        ),
      ),
      catchError((error) =>
        error instanceof HttpErrorResponse && error.status === 404
          ? of<BatchDetailsResult>({ kind: 'not-found' })
          : throwError(() => error),
      ),
    );
  }
}

@Injectable({ providedIn: 'root' })
export class RestUploadsSource extends UploadsSource {
  private readonly connection = inject(ApiConnection);
  private readonly details = inject(RestBatchDetailsSource);
  upload(request: UploadRequest): Observable<UploadResult> {
    const body = new FormData();
    body.append('stream_id', request.streamId);
    body.append('upload_id', request.uploadId);
    body.append('archive', request.archive, request.archive.name);
    if (request.metadata) body.append('metadata_file', request.metadata, request.metadata.name);
    return this.connection.post<ArchiveDto>('/batch-archives', body).pipe(map(intakeFromRest));
  }
  lookup(
    organizationId: string,
    streamId: string,
    uploadId: string,
  ): Observable<UploadResult | null> {
    return this.connection
      .get<{ items: BatchStateDto[] }>(
        '/batches',
        new HttpParams().set('customer_id', organizationId).set('stream_id', streamId),
      )
      .pipe(
        switchMap((response) => {
          const batch = response.items.find((b) => b.upload_id === uploadId);
          return batch
            ? this.connection
                .get<{ items: IntakeItem[] }>(
                  `/batches/${encodeURIComponent(batch.batch_id)}/files`,
                )
                .pipe(map((files) => intakeFromRest({ ...batch, items: files.items })))
            : of(null);
        }),
      );
  }
  restore(request: RestoreRequest): Observable<RestoreResult> {
    return this.upload(request).pipe(
      switchMap((result) => {
        if (result.batch.id !== request.batchId) throw new Error('batch-identity-changed');
        return this.details.batchDetails('customer', request.batchId);
      }),
      map((details) => {
        if (details.kind !== 'available') throw new Error('batch-unavailable');
        return details.details.batch.status === 'ready'
          ? { kind: 'restored' as const, details: details.details }
          : {
              kind: 'conflict' as const,
              details: details.details,
              message: 'Приём ещё не завершён. Проверьте ошибки файлов и повторите загрузку.',
            };
      }),
      catchError((error) =>
        editableUploadError(error)
          ? this.details.batchDetails('customer', request.batchId).pipe(
              map((details) => {
                if (details.kind !== 'available') throw error;
                return {
                  kind: 'conflict' as const,
                  details: details.details,
                  message: uploadErrorMessage(error),
                  fieldError: uploadFieldError(error),
                };
              }),
            )
          : throwError(() => error),
      ),
    );
  }
}
