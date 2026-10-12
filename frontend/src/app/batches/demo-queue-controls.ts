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
import { DemoAdminBatchesSource } from './demo-admin-batches-source';

@Component({
  selector: 'app-demo-queue-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="demo-controls">
      <summary>Демо-сценарии очереди</summary>
      <p>
        Каждый сбой действует на одну попытку запуска. Потеря ответа происходит после принятия
        задания; повтор не создаёт новое.
      </p>
      <div class="customer-actions">
        <button class="button secondary" (click)="source.simulateNextStartError()">
          Сбой следующего запуска
        </button>
        <button class="button secondary" (click)="source.simulateNextStartConfirmationLoss()">
          Потерять подтверждение следующего запуска
        </button>
        <button class="button secondary" (click)="readError()">
          Показать ошибку чтения очереди
        </button>
      </div>
      <p>
        «Следующий шаг» завершает текущий батч и начинает первый ожидающий. Результаты условные: все
        принятые записи успешны; оценки учитывают выбранные критерии. ZIP не анализируется, Whisper
        и LLM не вызываются.
      </p>
      <button class="button secondary" [disabled]="pending() || empty()" (click)="advance()">
        Имитировать следующий шаг очереди
      </button>
      @if (pending()) {
        <p role="status">Имитируем шаг очереди…</p>
      }
      @if (error()) {
        <p role="alert">Не удалось выполнить демо-шаг. Попробуйте ещё раз.</p>
      }
    </details>
  `,
})
export class DemoQueueControls {
  readonly empty = input(false);
  readonly changed = output<void>();
  readonly readRequested = output<void>();
  protected readonly pending = signal(false);
  protected readonly error = signal(false);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly source = inject(DemoAdminBatchesSource);
  protected readError(): void {
    this.source.simulateNextQueueError();
    this.readRequested.emit();
  }
  protected advance(): void {
    if (this.pending() || this.empty()) return;
    this.pending.set(true);
    this.error.set(false);
    this.source
      .advanceDemoQueue()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.pending.set(false);
          this.changed.emit();
        },
        error: () => {
          this.pending.set(false);
          this.error.set(true);
        },
      });
  }
}
