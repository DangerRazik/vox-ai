import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StartBatchesSource, StartBatchResult } from './admin-batches-source';
import { Batch, BATCH_STATUSES } from './batch-models';
import { HttpErrorResponse } from '@angular/common/http';
import { connectionError } from '../connection/api-connection';
import { BATCH_STATE_MESSAGES } from './batch-details';

export function launchMessage(result: StartBatchResult): string {
  if (result.kind === 'not-found') return 'Батч не найден или недоступен.';
  const details = result.details;
  const name = `${details.batch.name} · ${details.organization.name}`;
  return result.kind === 'not-ready'
    ? `${name}: запуск отклонён. ${BATCH_STATE_MESSAGES[details.batch.status]}`
    : `${name}: ${result.kind === 'accepted' ? 'поставлен в очередь' : 'повтор не создаёт новое задание'}. Текущее состояние — ${BATCH_STATUSES[details.batch.status].label}.`;
}

@Component({
  selector: 'app-batch-launch-action',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <p class="field-error" role="alert">
        {{ error() }}
      </p>
    }
    <button type="button" class="button primary" [disabled]="pending()" (click)="start()">
      {{
        pending()
          ? 'Отправляем запрос запуска…'
          : error()
            ? 'Повторить постановку'
            : repeat()
              ? 'Повторить запрос запуска'
              : 'Поставить в очередь'
      }}<span class="sr-only"> · {{ batch().name }}</span>
    </button>
  `,
})
export class BatchLaunchAction {
  readonly batch = input.required<Batch>();
  readonly repeat = input(false);
  readonly finished = output<StartBatchResult>();
  protected readonly pending = signal(false);
  protected readonly error = signal('');
  private readonly source = inject(StartBatchesSource);
  private readonly destroyRef = inject(DestroyRef);
  protected start(): void {
    if (this.pending()) return;
    this.pending.set(true);
    this.error.set('');
    this.source
      .start(this.batch().id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.pending.set(false);
          this.finished.emit(result);
        },
        error: (error) => {
          this.pending.set(false);
          this.error.set(
            error instanceof HttpErrorResponse && error.status === 403
              ? connectionError(error)
              : 'Подтверждение запуска не получено. Повторите запрос с тем же ID батча.',
          );
        },
      });
  }
}
