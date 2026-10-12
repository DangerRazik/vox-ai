import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  viewChild,
} from '@angular/core';
import { BATCH_STATE_MESSAGES } from '../batches/batch-details';
import { UploadResult } from './upload-models';

@Component({
  selector: 'app-upload-result',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="upload-result" aria-label="Результаты приёма" aria-live="polite">
      <h2 #heading tabindex="-1">
        {{ demo() ? 'Результаты демонстрационного приёма' : 'Результаты приёма' }}
      </h2>
      @if (demo()) {
        <p>Условные файлы сценария; это не анализ выбранного архива.</p>
      }
      <div class="intake-counts">
        <p>Принято уникальных записей: {{ result().accepted.length }}</p>
        <p>Дубликаты: {{ result().duplicates.length }}</p>
        <p>Ошибки файлов: {{ result().errors.length }}</p>
      </div>
      @if (result().duplicates.length) {
        <p>Дубликаты не входят в принятые записи и ошибки файлов.</p>
      }
      @if (!demo() && result().batch.status === 'upload_failed') {
        <div class="upload-error" role="alert">
          <h3>ZIP не принят</h3>
          <p>
            Проверьте ошибки ниже, выберите исправленный ZIP и повторите загрузку. Идентификатор и
            стрим сохранены.
          </p>
        </div>
      } @else if (!demo()) {
        <p class="info-note">
          {{ messages[result().batch.status] }}
          @if (result().errors.length && result().accepted.length) {
            Частичные ошибки не отменяют приём остальных записей.
          }
        </p>
      } @else if (result().accepted.length) {
        <p class="info-note">
          Ожидает ручного запуска командой Vox AI. Частичные ошибки не отменяют приём остальных
          записей.
        </p>
      } @else {
        <p class="field-error">Ни одной записи не принято. Батч не готов к запуску.</p>
      }
      <ul class="intake-files">
        @for (file of result().accepted; track $index) {
          <li>
            <strong>{{ file }}</strong> — Принят
          </li>
        }
        @for (file of result().duplicates; track $index) {
          <li>
            <strong>{{ file.filename }}</strong> — Дубликат {{ file.original }}
          </li>
        }
        @for (file of result().errors; track $index) {
          <li class="field-error">
            <strong>{{ file.filename }}</strong> — Ошибка: {{ file.reason }}
          </li>
        }
      </ul>
    </section>
  `,
})
export class UploadIntakeResult {
  readonly demo = input(true);
  protected readonly messages = BATCH_STATE_MESSAGES;
  readonly result = input.required<UploadResult>();
  private readonly heading = viewChild.required<ElementRef<HTMLHeadingElement>>('heading');
  constructor() {
    afterNextRender(() => this.heading().nativeElement.focus());
  }
}
