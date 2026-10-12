import {
  afterNextRender,
  computed,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Stream } from '../batches/batch-models';
import { UploadFiles, UploadFieldError } from './upload-models';

@Component({
  selector: 'app-zip-upload-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form (submit)="submit($event)" novalidate>
      <fieldset class="upload-fields" [disabled]="locked()">
        <legend class="sr-only">Файлы загрузки</legend>
        <div class="field">
          <label for="upload-stream">Стрим</label>
          <select
            id="upload-stream"
            #stream
            (change)="streamId.set(stream.value)"
            [attr.aria-invalid]="streamError() ? true : null"
            aria-describedby="stream-error"
            [disabled]="fixedStream()"
          >
            <option value="" [selected]="!selectedStream()">Выберите стрим</option>
            @for (item of streams(); track item.id) {
              <option [value]="item.id" [selected]="item.id === selectedStream()">
                {{ item.name }}
              </option>
            }
          </select>
          <p id="stream-error" class="field-error" role="alert">{{ streamError() }}</p>
        </div>
        <div class="field">
          <label for="upload-archive">Загрузить ZIP</label>
          <input
            id="upload-archive"
            type="file"
            accept=".zip"
            (change)="chooseArchive($event)"
            [attr.aria-invalid]="archiveMessage() ? true : null"
            aria-describedby="archive-hint archive-error"
          />
          <p id="archive-hint" class="scope-note">
            Выберите ZIP.
            {{
              demo()
                ? 'В демо содержимое и наличие пароля не проверяются.'
                : 'Содержимое проверяется сервером.'
            }}
          </p>
          <p id="archive-error" class="field-error" role="alert">{{ archiveMessage() }}</p>
        </div>
        <button class="button primary" type="submit">
          {{ submitLabel() }}
        </button>
      </fieldset>
    </form>
  `,
})
export class ZipUploadForm {
  readonly serverError = input<UploadFieldError | null>(null);
  readonly edited = output<void>();
  readonly demo = input(true);
  readonly streams = input.required<readonly Stream[]>();
  readonly initialStreamId = input('');
  readonly locked = input(false);
  readonly fixedStream = input(false);
  readonly submitLabel = input('Имитировать приём');
  readonly focusOnReady = input(false);
  private readonly streamElement = viewChild<ElementRef<HTMLSelectElement>>('stream');
  readonly submitted = output<UploadFiles>();
  protected readonly streamId = signal<string | null>(null);
  protected readonly archive = signal<File | null>(null);
  protected readonly streamError = signal('');
  protected readonly archiveError = signal('');

  protected readonly archiveMessage = computed(
    () =>
      this.archiveError() ||
      (this.serverError()?.field === 'archive' ? this.serverError()!.message : ''),
  );

  constructor() {
    afterNextRender(() => {
      if (this.focusOnReady()) this.streamElement()?.nativeElement.focus();
    });
  }

  protected selectedStream() {
    return this.streamId() ?? this.initialStreamId();
  }
  protected chooseArchive(event: Event) {
    this.archive.set((event.target as HTMLInputElement).files?.[0] ?? null);
    this.archiveError.set('');
    this.edited.emit();
  }
  protected submit(event: Event) {
    event.preventDefault();
    if (this.locked()) return;
    const streamId = this.selectedStream();
    const archive = this.archive();
    this.streamError.set(
      this.streams().some((item) => item.id === streamId) ? '' : 'Выберите стрим',
    );
    this.archiveError.set(
      !archive
        ? 'Выберите ZIP-файл'
        : !/\.zip$/i.test(archive.name)
          ? 'Нужен файл с расширением .zip'
          : '',
    );
    if (archive && !this.streamError() && !this.archiveError()) {
      this.submitted.emit({ streamId, archive, metadata: null });
    }
  }
}
