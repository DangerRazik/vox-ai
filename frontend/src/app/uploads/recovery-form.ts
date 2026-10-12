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

      <p class="scope-note">
        @if (initialImport()) {
          @if (details().batch.acceptedCalls) {
            Для продолжения загрузки выберите тот же ZIP. Принятые записи сохраняются.
          } @else {
            Выберите исправленный ZIP и повторите загрузку в этот батч.
          }
        } @else {
          Выберите ZIP со всем исходным набором записей. Архив можно упаковать заново.
        }
      </p>
      @if (error()) {
        <p class="field-error" role="alert">{{ error() }}</p>
      }
      <app-zip-upload-form
        [streams]="[details().stream]"
        [serverError]="serverError()"
        (edited)="edited.emit()"
        [initialStreamId]="details().stream.id"
        [fixedStream]="true"
        [showStream]="false"
        [locked]="locked()"
        [submitLabel]="initialImport() ? 'Повторить импорт' : 'Восстановить'"
        (submitted)="submitted.emit($event)"
      />
      <ng-content />
    </section>
  `,
})
export class RecoveryForm {
  readonly serverError = input<UploadFieldError | null>(null);
  readonly edited = output<void>();
  readonly details = input.required<BatchDetails>();
  readonly locked = input(false);
  readonly error = input('');
  readonly submitted = output<UploadFiles>();
  protected initialImport() {
    return ['upload_failed', 'uploading'].includes(this.details().batch.status);
  }
}
