import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CreatedCustomer } from './customers-source';

@Component({
  selector: 'app-customer-receipt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="customer-panel" aria-labelledby="created-customer-title">
      <h2 id="created-customer-title">Заказчик создан</h2>
      <p>{{ receipt().customer.name }}</p>
      <p class="stream-id">ID: {{ receipt().customer.id }}</p>
      <div class="field">
        <label for="issued-demo-key">{{
          demo() ? 'Демонстрационный ключ' : 'API-ключ заказчика'
        }}</label>
        <input
          type="text"
          id="issued-demo-key"
          #keyField
          readonly
          [value]="receipt().key"
          aria-describedby="demo-key-description"
        />
      </div>
      <p id="demo-key-description" class="section-description">
        @if (demo()) {
          Не подходит для подключения к backend.
        }
        Ключ показан только в результате создания; после закрытия его нельзя получить из списка.
      </p>
      <div class="customer-actions">
        <button class="button primary" [disabled]="copyState() === 'copying'" (click)="copy()">
          Скопировать ключ
        </button>
        <button class="button secondary" (click)="closed.emit()">Закрыть результат</button>
      </div>
      @if (copyState() === 'copied') {
        <p role="status">Ключ скопирован.</p>
      }
      @if (copyState() === 'error') {
        <p class="field-error" role="alert">
          Не удалось скопировать ключ. Выделите его в поле и скопируйте вручную или повторите
          попытку.
        </p>
      }
    </section>
  `,
})
export class CustomerReceipt {
  readonly demo = input(true);
  readonly receipt = input.required<CreatedCustomer>();
  readonly closed = output<void>();
  protected readonly copyState = signal<'idle' | 'copying' | 'copied' | 'error'>('idle');
  private readonly keyField = viewChild.required<ElementRef<HTMLInputElement>>('keyField');
  constructor() {
    afterNextRender(() => {
      this.keyField().nativeElement.focus();
      this.keyField().nativeElement.select();
    });
  }
  protected async copy(): Promise<void> {
    this.copyState.set('copying');
    try {
      await navigator.clipboard.writeText(this.receipt().key);
      this.copyState.set('copied');
    } catch {
      this.copyState.set('error');
    }
  }
}
