import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { BatchDetails } from '../batches/batch-details';
import { ZipUploadForm } from './zip-upload-form';
import { UploadFiles, UploadFieldError } from './upload-models';

@Component({
  selector: 'app-recovery-form',
  imports: [ZipUploadForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="upload-panel batch-details" aria-label="Повторная загрузка">
      <h2>{{ initialImport() ? 'Повтор первичного импорта' : 'Восстановление батча' }}</h2>
      @if (demo()) {
        <p class="info-note">
          Локальная имитация. ZIP не распаковывается и файлы никуда не отправляются. Состав
          проверяется условно; результат сценария не описывает выбранный архив.
        </p>
      }
      <p>
        {{
          initialImport()
            ? 'Состав ещё не закрыт. Исправленный архив импортируется в тот же батч с прежним ID загрузки.'
            : 'Передайте весь исходный набор уникальных записей. ZIP можно упаковать заново; важен состав по содержимому, а не имя или байты архива.'
        }}
      </p>
      <p>
        Стрим и идентификатор загрузки сохраняются.
        @if (initialImport()) {
          Для продолжения частичного импорта передайте тот же ZIP с тем же составом записей.
        }
      </p>
      @if (error()) {
        <p class="field-error" role="alert">{{ error() }}</p>
      }
      <app-zip-upload-form
        [streams]="[details().stream]"
        [demo]="demo()"
        [serverError]="serverError()"
        (edited)="edited.emit()"
        [initialStreamId]="details().stream.id"
        [fixedStream]="true"
        [locked]="locked()"
        [submitLabel]="
          demo()
            ? initialImport()
              ? 'Имитировать повтор импорта'
              : 'Имитировать восстановление'
            : initialImport()
              ? 'Повторить импорт'
              : 'Восстановить'
        "
        (submitted)="submitted.emit($event)"
      />
      <ng-content />
    </section>
  `,
})
export class RecoveryForm {
  readonly serverError = input<UploadFieldError | null>(null);
  readonly edited = output<void>();
  readonly demo = input(true);
  readonly details = input.required<BatchDetails>();
  readonly locked = input(false);
  readonly error = input('');
  readonly submitted = output<UploadFiles>();
  protected initialImport() {
    return ['upload_failed', 'uploading'].includes(this.details().batch.status);
  }
}
