import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';
import { Stream } from '../batches/batch-models';

@Component({
  selector: 'app-delete-stream-confirmation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialog
      tabindex="-1"
      aria-labelledby="delete-stream-title"
      aria-describedby="delete-stream-description"
      class="delete-stream-dialog"
      (cancel)="escape($event)"
      (keydown)="keepFocus($event)"
    >
      <h2 id="delete-stream-title">Удаление стрима</h2>
      <p class="delete-stream-name">«{{ stream().name }}»</p>
      <p class="stream-id">ID: {{ stream().id }}</p>
      <p id="delete-stream-description">
        Будут удалены его батчи, транскрипции и вся история результатов. Данные других стримов
        сохранятся. Отменить выполненное удаление нельзя.
      </p>
      @if (requestError()) {
        <p class="field-error" role="alert">{{ requestError() }}</p>
      }
      @if (locked()) {
        <p role="status">Удаляем стрим…</p>
      }
      <div class="customer-actions">
        <button
          #cancelButton
          type="button"
          class="button secondary"
          [disabled]="locked()"
          (click)="cancel()"
        >
          Отмена
        </button>
        <button
          type="button"
          class="button danger"
          [disabled]="locked()"
          (click)="confirmed.emit()"
        >
          Удалить стрим и историю
        </button>
      </div>
    </dialog>
  `,
})
export class DeleteStreamConfirmation {
  readonly stream = input.required<Stream>();
  readonly locked = input(false);
  readonly requestError = input('');
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly cancelButton = viewChild.required<ElementRef<HTMLButtonElement>>('cancelButton');
  constructor() {
    afterNextRender(() => {
      this.dialog().nativeElement.showModal();
      this.cancelButton().nativeElement.focus();
    });
  }
  protected cancel(): void {
    if (this.locked()) return;
    this.dialog().nativeElement.close();
    this.cancelled.emit();
  }
  protected escape(event: Event): void {
    event.preventDefault();
    this.cancel();
  }
  protected keepFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const dialog = this.dialog().nativeElement;
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const first = buttons[0];
    const last = buttons.at(-1);
    if (!first) {
      event.preventDefault();
      dialog.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last!.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
