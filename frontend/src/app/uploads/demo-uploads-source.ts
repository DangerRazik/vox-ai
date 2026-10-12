import { createUuid } from '../shared/uuid';
import { inject, Injectable } from '@angular/core';
import { defer, finalize, map, switchMap, timer } from 'rxjs';
import { DemoBatchesSource } from '../batches/demo-batches-source';
import {
  RestoreRequest,
  RestoreResult,
  UploadRequest,
  UploadResult,
  UploadsSource,
} from './upload-models';

export type IntakeScenario = 'partial' | 'success' | 'empty';
export type RecoveryScenario = 'complete' | 'incomplete' | 'changed';

@Injectable({ providedIn: 'root' })
export class DemoUploadsSource extends UploadsSource {
  private readonly batches = inject(DemoBatchesSource);
  private readonly results = new Map<string, UploadResult>();
  scenario: IntakeScenario = 'partial';
  loseConfirmation = false;
  recoveryScenario: RecoveryScenario = 'complete';
  interruptRecovery = false;
  retryImportScenario: 'success' | 'failure' = 'success';
  private readonly recoveryRecords = new Map<string, Set<string>>();
  private readonly interruptedRequests = new WeakSet<RestoreRequest>();

  forgetStream(streamId: string): void {
    for (const [key, result] of this.results) {
      if (result.batch.streamId === streamId) this.results.delete(key);
    }
    for (const batchId of this.recoveryRecords.keys()) {
      if (this.batches.currentDetails('team', batchId)?.stream.id === streamId)
        this.recoveryRecords.delete(batchId);
    }
  }

  override restore(request: RestoreRequest) {
    return defer(() => {
      const finishImport = this.batches.beginImport(request.streamId);
      const scenario = this.recoveryScenario;
      const interrupt = this.interruptRecovery;
      const importScenario = this.retryImportScenario;
      return timer(500).pipe(
        map((): RestoreResult => {
          const details = this.batches.currentDetails('customer', request.batchId);
          if (!details || details.organization.id !== request.organizationId)
            throw new Error('Батч недоступен');
          if (details.uploadId !== request.uploadId || details.stream.id !== request.streamId) {
            return {
              kind: 'conflict',
              details,
              message: 'Идентификатор загрузки и стрим должны совпадать с исходными.',
            };
          }
          if (details.batch.status === 'ready') return { kind: 'restored', details };
          if (details.batch.status !== 'batch_failed' && details.batch.status !== 'upload_failed') {
            return {
              kind: 'conflict',
              details,
              message: 'Текущее состояние не допускает повторную загрузку.',
            };
          }
          const acceptedCalls =
            details.batch.status === 'batch_failed' ? details.batch.acceptedCalls : 2;
          if (details.batch.status === 'upload_failed' && importScenario === 'failure') {
            return {
              kind: 'conflict',
              details,
              message: 'Не удалось распаковать повторный ZIP. Исправьте архив и повторите импорт.',
            };
          }
          if (details.batch.status === 'batch_failed') {
            const originals = Array.from(
              { length: acceptedCalls },
              (_, index) => `original-${index + 1}`,
            );
            const received = this.recoveryRecords.get(details.batch.id) ?? new Set<string>();
            this.recoveryRecords.set(details.batch.id, received);
            const firstInterruption = interrupt && !this.interruptedRequests.has(request);
            const submitted = firstInterruption
              ? originals.slice(0, Math.ceil(originals.length / 2))
              : scenario === 'complete'
                ? originals
                : originals.slice(0, -1);
            for (const record of submitted) received.add(record);
            this.batches.registerUploadedBatch(details.batch, {
              uploadId: details.uploadId,
              failure: details.failure,
              recovery: { expectedCalls: acceptedCalls, receivedCalls: received.size },
            });
            const updated = this.batches.currentDetails('customer', request.batchId)!;
            if (firstInterruption) {
              this.interruptedRequests.add(request);
              throw new Error('Демонстрационный обрыв восстановительной передачи');
            }
            if (scenario === 'changed')
              return {
                kind: 'conflict',
                details: updated,
                message:
                  'В повторной загрузке есть запись вне исходного состава. Передайте исходный набор.',
              };
            if (received.size !== acceptedCalls)
              return {
                kind: 'conflict',
                details: updated,
                message: 'Повторно переданы не все исходные записи. Батч ещё не восстановлен.',
              };
          }
          this.batches.registerUploadedBatch(
            { ...details.batch, status: 'ready', acceptedCalls },
            {
              uploadId: details.uploadId,
              failure: null,
              ...(details.batch.status === 'upload_failed' ? { uploadErrors: 0 } : {}),
              recovery:
                details.batch.status === 'batch_failed'
                  ? { expectedCalls: acceptedCalls, receivedCalls: acceptedCalls }
                  : null,
            },
          );
          if (details.batch.status === 'upload_failed') {
            const key = `${request.organizationId}:${request.uploadId}`;
            const initial = this.results.get(key);
            if (initial)
              this.results.set(key, {
                ...initial,
                batch: this.batches.currentDetails('customer', request.batchId)!.batch,
                accepted: ['calls/001.wav', 'calls/002.wav'],
                duplicates: [],
                errors: [],
              });
          }
          return {
            kind: 'restored',
            details: this.batches.currentDetails('customer', request.batchId)!,
          };
        }),
        finalize(finishImport),
      );
    });
  }

  override upload(request: UploadRequest) {
    return defer(() => {
      const finishImport = this.batches.beginImport(request.streamId);
      const scenario = this.scenario;
      const loseConfirmation = this.loseConfirmation;
      return this.batches.workspace('customer').pipe(
        switchMap((workspace) => {
          if (!workspace.organizations.some((item) => item.id === request.organizationId)) {
            throw new Error('Организация недоступна');
          }
          return this.batches.streams(request.organizationId);
        }),
        switchMap((streams) => {
          if (!streams.some((item) => item.id === request.streamId)) {
            throw new Error('Стрим недоступен');
          }
          return timer(500);
        }),
        map(() => {
          const key = `${request.organizationId}:${request.uploadId}`;
          const existing = this.results.get(key);
          if (existing) {
            if (existing.batch.streamId !== request.streamId)
              throw new Error('Стрим загрузки изменён');
            return existing;
          }
          const accepted = scenario === 'empty' ? [] : ['calls/001.wav', 'calls/002.wav'];
          const result: UploadResult = {
            uploadId: request.uploadId,
            batch: {
              id: createUuid(),
              organizationId: request.organizationId,
              streamId: request.streamId,
              name: request.archive.name,
              filename: request.archive.name,
              createdAt: new Date().toISOString(),
              status: accepted.length ? 'ready' : 'upload_failed',
              acceptedCalls: accepted.length,
              averageTotal: null,
            },
            accepted,
            duplicates:
              scenario === 'partial'
                ? [{ filename: 'calls/001-copy.wav', original: 'calls/001.wav' }]
                : [],
            errors:
              scenario === 'success'
                ? []
                : scenario === 'empty'
                  ? [
                      { filename: 'calls/001.wav', reason: 'Не удалось прочитать аудиозапись' },
                      { filename: 'calls/002.wav', reason: 'Не удалось прочитать аудиозапись' },
                    ]
                  : [{ filename: 'calls/broken.wav', reason: 'Не удалось прочитать аудиозапись' }],
          };
          this.results.set(key, result);
          this.batches.registerUploadedBatch(result.batch, {
            uploadId: request.uploadId,
            uploadErrors: result.errors.length,
            failure: accepted.length
              ? null
              : 'Ни одной записи не принято при первичном импорте ZIP.',
          });
          if (loseConfirmation) throw new Error('Демонстрационная потеря подтверждения');
          return result;
        }),
        finalize(finishImport),
      );
    });
  }
}
