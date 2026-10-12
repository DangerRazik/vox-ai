import { inject, Injectable } from '@angular/core';
import { defer, map, timer } from 'rxjs';
import { DemoAccess } from '../shared/demo-access';
import { DemoBatchesSource } from './demo-batches-source';
import { AdminBatchesSource, BatchQueue, StartBatchResult } from './admin-batches-source';

@Injectable({ providedIn: 'root' })
export class DemoAdminBatchesSource extends AdminBatchesSource {
  private readonly batches = inject(DemoBatchesSource);
  private readonly access = inject(DemoAccess);
  private processingId: string | null = 'batch-06';
  private waitingIds: readonly string[] = ['outgoing-06'];
  private failNextStart = false;
  private loseNextConfirmation = false;
  private failNextQueue = false;
  simulateNextQueueError(): void {
    this.failNextQueue = true;
  }
  simulateNextStartError(): void {
    this.failNextStart = true;
  }
  simulateNextStartConfirmationLoss(): void {
    this.loseNextConfirmation = true;
  }
  override start(batchId: string) {
    return defer(() => {
      const fail = this.failNextStart;
      const lose = this.loseNextConfirmation;
      this.failNextStart = false;
      this.loseNextConfirmation = false;
      return timer(350).pipe(
        map((): StartBatchResult => {
          this.access.requireTeam();
          if (fail) throw new Error('Демонстрационный сбой до постановки в очередь');
          const details = this.batches.currentDetails('team', batchId);
          if (!details) return { kind: 'not-found' };
          if (['queued', 'processing', 'completed'].includes(details.batch.status))
            return { kind: 'current', details };
          if (details.batch.status !== 'ready' || !details.batch.acceptedCalls)
            return { kind: 'not-ready', details };
          this.batches.registerUploadedBatch({ ...details.batch, status: 'queued' });
          this.waitingIds = [...this.waitingIds, batchId];
          if (lose) throw new Error('Демонстрационная потеря подтверждения после постановки');
          return { kind: 'accepted', details: this.batches.currentDetails('team', batchId)! };
        }),
      );
    });
  }
  override queue() {
    return defer(() => {
      const fail = this.failNextQueue;
      this.failNextQueue = false;
      return timer(350).pipe(
        map(() => {
          this.access.requireTeam();
          if (fail) throw new Error('Демонстрационная ошибка чтения очереди');
          return this.snapshot();
        }),
      );
    });
  }
  advanceDemoQueue() {
    return timer(350).pipe(
      map(() => {
        this.access.requireTeam();
        const snapshot = this.snapshot();
        if (snapshot.processing) this.batches.completeDemoBatch(snapshot.processing.batch.id);
        const [next, ...waiting] = snapshot.waiting;
        this.processingId = next?.batch.id ?? null;
        this.waitingIds = waiting.map((item) => item.batch.id);
        if (next) this.batches.registerUploadedBatch({ ...next.batch, status: 'processing' });
        return this.snapshot();
      }),
    );
  }
  private snapshot(): BatchQueue {
    const processing = this.processingId
      ? this.batches.currentDetails('team', this.processingId)
      : null;
    const waiting = this.waitingIds.flatMap((id) => {
      const details = this.batches.currentDetails('team', id);
      return details?.batch.status === 'queued' ? [details] : [];
    });
    return { processing: processing?.batch.status === 'processing' ? processing : null, waiting };
  }
}
