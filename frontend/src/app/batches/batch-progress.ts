import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { BatchStatus } from './batch-models';
import { ProcessingProgress } from './batch-details';

@Component({
  selector: 'app-batch-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="batch-progress" aria-label="Прогресс обработки">
      <div class="batch-progress-heading">
        <span>{{ label() }}</span>
        @if (status() !== 'queued' && progress(); as count) {
          <span class="batch-progress-count"
            >Обработано {{ count.processedCalls }} из {{ count.totalCalls }}
            @if (percent() !== null) {
              · {{ percent() }}%
            }
          </span>
        }
      </div>
      @if (canControl() && status() === 'processing') {
        <div class="batch-progress-actions">
          <button
            class="button secondary"
            type="button"
            [disabled]="locked()"
            (click)="pauseChanged.emit(!isPaused())"
          >
            {{ locked() ? 'Отправляем…' : isPaused() ? 'Продолжить' : 'Пауза' }}
          </button>
          @if (isPaused()) {
            <span class="batch-progress-note">Остальные батчи ждут продолжения</span>
          }
        </div>
      }
      @if (error()) {
        <p class="field-error" role="alert">{{ error() }}</p>
      }
      @if (status() === 'queued') {
        <p class="batch-progress-note">Ожидает начала обработки</p>
      } @else {
        <progress max="100" [attr.value]="percent()" aria-label="Обработка звонков"></progress>
      }
      @if (stale()) {
        <p class="batch-progress-note" role="status">
          Не удалось обновить прогресс. Показаны последние полученные сведения.
        </p>
      }
    </section>
  `,
})
export class BatchProgress {
  readonly status = input.required<BatchStatus>();
  readonly progress = input<ProcessingProgress | null>(null);
  readonly stale = input(false);
  readonly canControl = input(false);
  readonly locked = input(false);
  readonly error = input('');
  readonly pauseChanged = output<boolean>();
  protected readonly isPaused = computed(
    () => !!(this.progress()?.paused || this.progress()?.pauseRequested),
  );
  protected readonly percent = computed(() => {
    if (this.status() === 'completed') return 100;
    const count = this.progress();
    if (!count || count.totalCalls <= 0) return null;
    return Math.min(99, Math.max(0, Math.floor((count.processedCalls / count.totalCalls) * 100)));
  });
  protected readonly label = computed(() => {
    if (this.status() === 'queued') return 'В очереди';
    if (this.status() === 'completed') return 'Обработка завершена';
    if (this.status() === 'batch_failed') return 'Обработка прервана';
    const count = this.progress();
    if (count?.paused) return 'На паузе';
    if (count?.pauseRequested) return 'Ожидаем завершения текущего звонка для паузы';
    return count && count.totalCalls > 0 && count.processedCalls >= count.totalCalls
      ? 'Сохраняем результаты'
      : 'Обработка звонков';
  });
}
