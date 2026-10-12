import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

@Component({
  selector: 'app-customer-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form (submit)="submit($event)" novalidate>
      <div class="field">
        <label for="customer-name">Название заказчика</label>
        <input
          id="customer-name"
          #nameField
          type="text"
          autocomplete="organization"
          [value]="name()"
          (input)="edit(nameField.value)"
          [disabled]="locked()"
          [attr.aria-invalid]="nameError() || fieldError() ? true : null"
          aria-describedby="customer-name-error"
        />
        @if (nameError() || fieldError()) {
          <p id="customer-name-error" class="field-error" role="alert">
            {{ nameError() || fieldError() }}
          </p>
        }
      </div>
      @if (requestError()) {
        <p class="field-error" role="alert">{{ requestError() }}</p>
      }
      <button type="submit" class="button primary" [disabled]="locked()">
        {{
          locked()
            ? 'Создаём заказчика…'
            : requestError() || fieldError()
              ? 'Повторить создание'
              : 'Создать заказчика'
        }}
      </button>
    </form>
  `,
})
export class CustomerForm {
  readonly locked = input(false);
  readonly requestError = input('');
  readonly fieldError = input('');
  readonly edited = output<void>();
  readonly focusOnReady = input(false);
  readonly submitted = output<string>();
  protected readonly name = signal('');
  protected readonly nameError = signal('');
  private readonly nameField = viewChild.required<ElementRef<HTMLInputElement>>('nameField');
  constructor() {
    afterRenderEffect(() => {
      if (this.fieldError()) this.nameField().nativeElement.focus();
    });
    afterNextRender(() => {
      if (this.focusOnReady()) this.nameField().nativeElement.focus();
    });
  }
  protected edit(value: string): void {
    this.edited.emit();
    this.name.set(value);
    if (value.trim()) this.nameError.set('');
  }
  protected submit(event: Event): void {
    event.preventDefault();
    if (this.locked()) return;
    if (!this.name().trim()) {
      this.nameError.set('Укажите название заказчика. Одних пробелов недостаточно.');
      this.nameField().nativeElement.focus();
      return;
    }
    if ([...this.name().trim()].length > 200) {
      this.nameError.set('Название заказчика должно содержать не больше 200 символов.');
      this.nameField().nativeElement.focus();
      return;
    }
    this.nameError.set('');
    this.submitted.emit(this.name().trim());
  }
}
